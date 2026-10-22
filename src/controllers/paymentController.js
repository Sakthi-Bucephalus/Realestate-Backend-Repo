const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const { BOOKING_STATUSES, AUDIT_ACTIONS } = require('../constants/statuses');
const { logAudit } = require('../services/auditService');

// Helper to generate payment reference
const generatePaymentReference = async (organizationId) => {
  const count = await Payment.countDocuments({ organizationId });
  const year = new Date().getFullYear();
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-PAY-${year}-${sequence}`;
};

// 1. Get all payments
const getPayments = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      bookingId = '',
      customerId = '',
      paymentMethod = '',
      startDate = '',
      endDate = '',
      sortBy = 'paymentDate',
      sortOrder = 'desc',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (bookingId) query.bookingId = bookingId;
    if (customerId) query.customerId = customerId;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name phone email customerCode')
        .populate('bookingId', 'bookingReference agreedPrice totalPaid balanceDue')
        .populate('recordedBy', 'firstName lastName email')
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Payment.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: payments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. Record new payment
const recordPayment = async (req, res, next) => {
  try {
    const {
      bookingId,
      amount,
      paymentMethod,
      paymentType,
      transactionReference,
      paymentDate,
      notes,
    } = req.body;

    if (!bookingId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Booking, payment amount, and payment method are required.',
      });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be a positive number.',
      });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      organizationId: req.organizationId,
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status === BOOKING_STATUSES.CANCELLED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot record payment for a cancelled booking.',
      });
    }

    const paymentReference = await generatePaymentReference(req.organizationId);

    const payment = await Payment.create({
      organizationId: req.organizationId,
      paymentReference,
      bookingId: booking._id,
      customerId: booking.customerId,
      amount: numAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      paymentType: paymentType || 'Installment',
      transactionReference: transactionReference || '',
      recordedBy: req.user._id,
      notes: notes || '',
      receiptNumber: `REC-${paymentReference.replace('EF-PAY-', '')}`,
    });

    // Update booking financials
    booking.totalPaid = (booking.totalPaid || 0) + numAmount;
    booking.balanceDue = Math.max(0, booking.agreedPrice - booking.totalPaid);

    if (booking.totalPaid >= booking.agreedPrice && booking.status === BOOKING_STATUSES.CONFIRMED) {
      booking.status = BOOKING_STATUSES.COMPLETED;
    }

    booking.history.push({
      action: 'Payment Received',
      performedBy: req.user._id,
      note: `Amount of ₹${numAmount.toLocaleString()} recorded via ${paymentMethod} (${payment.paymentReference})`,
    });

    await booking.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.PAYMENT_RECORDED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Payment',
      entityId: payment._id,
      details: {
        paymentReference: payment.paymentReference,
        amount: numAmount,
        bookingReference: booking.bookingReference,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Payment recorded and ledger updated successfully',
      data: payment,
      bookingSummary: {
        agreedPrice: booking.agreedPrice,
        totalPaid: booking.totalPaid,
        balanceDue: booking.balanceDue,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 3. Reverse payment entry (Audit-compliant financial correction)
const reversePayment = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'A formal reason is required to reverse a financial ledger entry.',
      });
    }

    const payment = await Payment.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment entry not found' });
    }

    if (payment.isReversed) {
      return res.status(400).json({ success: false, message: 'This payment entry has already been reversed.' });
    }

    payment.isReversed = true;
    payment.reversedAt = new Date();
    payment.reversedBy = req.user._id;
    payment.reversalReason = reason;
    await payment.save();

    // Adjust booking totalPaid
    const booking = await Booking.findById(payment.bookingId);
    if (booking) {
      booking.totalPaid = Math.max(0, (booking.totalPaid || 0) - payment.amount);
      booking.balanceDue = Math.max(0, booking.agreedPrice - booking.totalPaid);

      if (booking.status === BOOKING_STATUSES.COMPLETED) {
        booking.status = BOOKING_STATUSES.CONFIRMED;
      }

      booking.history.push({
        action: 'Payment Reversed',
        performedBy: req.user._id,
        note: `Payment ${payment.paymentReference} of ₹${payment.amount.toLocaleString()} was reversed. Reason: ${reason}`,
      });

      await booking.save();
    }

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.PAYMENT_REVERSED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Payment',
      entityId: payment._id,
      details: { amount: payment.amount, reason },
      req,
    });

    return res.json({
      success: true,
      message: 'Payment reversal recorded and ledger adjusted.',
      data: payment,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Get printable receipt data
const getReceiptData = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    })
      .populate('customerId')
      .populate('recordedBy', 'firstName lastName')
      .populate({
        path: 'bookingId',
        populate: { path: 'propertyId' },
      })
      .lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    return res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPayments,
  recordPayment,
  reversePayment,
  getReceiptData,
};
