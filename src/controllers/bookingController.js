const Booking = require('../models/Booking');
const Property = require('../models/Property');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const { BOOKING_STATUSES, PROPERTY_AVAILABILITY, AUDIT_ACTIONS } = require('../constants/statuses');
const { ROLES } = require('../constants/roles');
const { logAudit } = require('../services/auditService');

// Helper to generate booking reference
const generateBookingReference = async (organizationId) => {
  const count = await Booking.countDocuments({ organizationId });
  const year = new Date().getFullYear();
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-BK-${year}-${sequence}`;
};

// 1. Get all bookings
const getBookings = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      customerId = '',
      propertyId = '',
      assignedTo = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (req.user.role === ROLES.EMPLOYEE) {
      query.assignedTo = req.user._id;
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (status) query.status = status;
    if (customerId) query.customerId = customerId;
    if (propertyId) query.propertyId = propertyId;

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ bookingReference: regex }];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate('customerId', 'name phone email customerCode')
        .populate('propertyId', 'title unitNumber propertyType pricing location')
        .populate('assignedTo', 'firstName lastName email department avatar')
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: bookings,
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

// 2. Get booking by ID (With ledger payments & property details)
const getBookingById = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    })
      .populate('customerId')
      .populate('propertyId')
      .populate('assignedTo', 'firstName lastName email phone department')
      .populate('history.performedBy', 'firstName lastName email')
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Fetch linked payment receipts
    const payments = await Payment.find({ bookingId: booking._id })
      .populate('recordedBy', 'firstName lastName')
      .sort({ paymentDate: -1 })
      .lean();

    return res.json({
      success: true,
      data: {
        ...booking,
        payments,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 3. Create Booking (Concurrency-Safe Property Reservation)
const createBooking = async (req, res, next) => {
  try {
    const {
      customerId,
      propertyId,
      agreedPrice,
      bookingAmount,
      paymentTerms,
      assignedTo,
      notes,
    } = req.body;

    if (!customerId || !propertyId || agreedPrice === undefined || bookingAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Customer, property, agreed purchase price, and initial booking amount are required.',
      });
    }

    if (agreedPrice <= 0 || bookingAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Agreed price must be positive, and booking amount cannot be negative.',
      });
    }

    if (bookingAmount > agreedPrice) {
      return res.status(400).json({
        success: false,
        message: 'Initial booking amount cannot exceed the agreed purchase price.',
      });
    }

    // ATOMIC RESERVATION: Ensure property is AVAILABLE and reserve it in one atomic update
    const reservedProperty = await Property.findOneAndUpdate(
      {
        _id: propertyId,
        organizationId: req.organizationId,
        status: PROPERTY_AVAILABILITY.AVAILABLE,
      },
      {
        $set: { status: PROPERTY_AVAILABILITY.RESERVED },
        $push: {
          statusHistory: {
            previousStatus: PROPERTY_AVAILABILITY.AVAILABLE,
            newStatus: PROPERTY_AVAILABILITY.RESERVED,
            reason: 'Locked for deal booking creation',
            changedBy: req.user._id,
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!reservedProperty) {
      return res.status(409).json({
        success: false,
        message: 'The selected property or plot is no longer available or is currently reserved/sold by another client.',
      });
    }

    const bookingReference = await generateBookingReference(req.organizationId);

    const booking = await Booking.create({
      organizationId: req.organizationId,
      bookingReference,
      customerId,
      propertyId,
      agreedPrice,
      bookingAmount,
      totalPaid: 0,
      balanceDue: agreedPrice,
      paymentTerms: paymentTerms || 'Standard 30-day milestone payment schedule',
      assignedTo: assignedTo || req.user._id,
      status: BOOKING_STATUSES.PENDING_APPROVAL,
      notes: notes || '',
      history: [
        {
          action: 'Booking Created',
          performedBy: req.user._id,
          note: `Deal initiated with agreed price ₹${agreedPrice.toLocaleString()}`,
        },
      ],
    });

    // Link active booking to property
    reservedProperty.activeBookingId = booking._id;
    await reservedProperty.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.BOOKING_CREATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Booking',
      entityId: booking._id,
      details: {
        bookingReference: booking.bookingReference,
        agreedPrice: booking.agreedPrice,
        unit: reservedProperty.unitNumber,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully and property unit reserved!',
      data: booking,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Confirm Booking (Locks property to Sold)
const confirmBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status === BOOKING_STATUSES.CONFIRMED) {
      return res.status(400).json({ success: false, message: 'Booking is already confirmed.' });
    }

    booking.status = BOOKING_STATUSES.CONFIRMED;
    booking.history.push({
      action: 'Booking Confirmed',
      performedBy: req.user._id,
      note: 'Deal formally approved and confirmed',
    });

    await booking.save();

    // Mark property as Sold
    await Property.findByIdAndUpdate(booking.propertyId, {
      status: PROPERTY_AVAILABILITY.SOLD,
      $push: {
        statusHistory: {
          previousStatus: PROPERTY_AVAILABILITY.RESERVED,
          newStatus: PROPERTY_AVAILABILITY.SOLD,
          reason: `Deal confirmed via booking ${booking.bookingReference}`,
          changedBy: req.user._id,
          timestamp: new Date(),
        },
      },
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.BOOKING_CONFIRMED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Booking',
      entityId: booking._id,
      details: { bookingReference: booking.bookingReference },
      req,
    });

    return res.json({
      success: true,
      message: 'Booking confirmed and unit marked as Sold!',
      data: booking,
    });
  } catch (err) {
    next(err);
  }
};

// 5. Cancel Booking (Releases property back to Available)
const cancelBooking = async (req, res, next) => {
  try {
    const { reason, refundAmount = 0 } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to cancel this booking.' });
    }

    const booking = await Booking.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status === BOOKING_STATUSES.CANCELLED) {
      return res.status(400).json({ success: false, message: 'Booking has already been cancelled.' });
    }

    booking.status = BOOKING_STATUSES.CANCELLED;
    booking.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: req.user._id,
      reason,
      refundAmount: Number(refundAmount) || 0,
    };

    booking.history.push({
      action: 'Booking Cancelled',
      performedBy: req.user._id,
      note: `Cancelled. Reason: ${reason}. Refund: ₹${Number(refundAmount).toLocaleString()}`,
    });

    await booking.save();

    // Release property back to Available
    await Property.findByIdAndUpdate(booking.propertyId, {
      status: PROPERTY_AVAILABILITY.AVAILABLE,
      activeBookingId: null,
      $push: {
        statusHistory: {
          previousStatus: PROPERTY_AVAILABILITY.RESERVED,
          newStatus: PROPERTY_AVAILABILITY.AVAILABLE,
          reason: `Released due to cancellation of booking ${booking.bookingReference}`,
          changedBy: req.user._id,
          timestamp: new Date(),
        },
      },
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.BOOKING_CANCELLED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Booking',
      entityId: booking._id,
      details: { reason, refundAmount },
      req,
    });

    return res.json({
      success: true,
      message: 'Booking cancelled and property released back to Available inventory.',
      data: booking,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getBookings,
  getBookingById,
  createBooking,
  confirmBooking,
  cancelBooking,
};
