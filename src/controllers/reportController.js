const Lead = require('../models/Lead');
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const SiteVisit = require('../models/SiteVisit');
const User = require('../models/User');

// 1. Comprehensive Business Reports Summary
const getReportsSummary = async (req, res, next) => {
  try {
    const orgId = req.organizationId;
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const [
      leadsBySource,
      leadsByStatus,
      propertyByType,
      propertyByStatus,
      bookingSummary,
      paymentSummary,
      agentPerformance,
    ] = await Promise.all([
      // Leads grouped by source
      Lead.aggregate([
        { $match: { organizationId: orgId, ...dateFilter } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Leads grouped by status
      Lead.aggregate([
        { $match: { organizationId: orgId, ...dateFilter } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Properties by type
      Property.aggregate([
        { $match: { organizationId: orgId } },
        {
          $group: {
            _id: '$propertyType',
            count: { $sum: 1 },
            totalValue: { $sum: '$pricing.basePrice' },
          },
        },
      ]),

      // Properties by availability status
      Property.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Bookings summary
      Booking.aggregate([
        { $match: { organizationId: orgId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAgreedPrice: { $sum: '$agreedPrice' },
            totalPaid: { $sum: '$totalPaid' },
            totalBalanceDue: { $sum: '$balanceDue' },
          },
        },
      ]),

      // Payments by payment method
      Payment.aggregate([
        { $match: { organizationId: orgId, isReversed: false } },
        {
          $group: {
            _id: '$paymentMethod',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]),

      // Sales executives performance
      User.aggregate([
        { $match: { organizationId: orgId, isActive: true } },
        {
          $lookup: {
            from: 'leads',
            localField: '_id',
            foreignField: 'assignedTo',
            as: 'leads',
          },
        },
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'assignedTo',
            as: 'bookings',
          },
        },
        {
          $project: {
            name: { $concat: ['$firstName', ' ', '$lastName'] },
            email: '$email',
            department: '$department',
            role: '$role',
            totalLeads: { $size: '$leads' },
            totalBookings: { $size: '$bookings' },
          },
        },
        { $sort: { totalBookings: -1, totalLeads: -1 } },
      ]),
    ]);

    return res.json({
      success: true,
      data: {
        leadsBySource,
        leadsByStatus,
        propertyByType,
        propertyByStatus,
        bookingSummary,
        paymentSummary,
        agentPerformance,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. CSV Export Endpoint for various datasets
const exportReportCSV = async (req, res, next) => {
  try {
    const { type } = req.params;
    const orgId = req.organizationId;

    let csvContent = '';
    let fileName = `estateflow_${type}_${Date.now()}.csv`;

    if (type === 'leads') {
      const leads = await Lead.find({ organizationId: orgId })
        .populate('assignedTo', 'firstName lastName')
        .lean();

      csvContent = 'Lead Code,Name,Phone,Email,Property Preference,Budget Min,Budget Max,Status,Source,Assigned To,Created At\n';
      leads.forEach((l) => {
        const assignedName = l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : 'Unassigned';
        csvContent += `"${l.leadCode}","${l.name}","${l.phone}","${l.email || ''}","${l.preferredPropertyType || ''}",${l.budgetMin || 0},${l.budgetMax || 0},"${l.status}","${l.source}","${assignedName}","${l.createdAt.toISOString()}"\n`;
      });
    } else if (type === 'properties') {
      const properties = await Property.find({ organizationId: orgId }).lean();
      csvContent = 'Property Code,Title,Type,Unit Number,Project,Area,Unit,Base Price,Status,Created At\n';
      properties.forEach((p) => {
        csvContent += `"${p.propertyCode}","${p.title}","${p.propertyType}","${p.unitNumber}","${p.projectName || ''}",${p.area.value},"${p.area.unit}",${p.pricing.basePrice},"${p.status}","${p.createdAt.toISOString()}"\n`;
      });
    } else if (type === 'bookings') {
      const bookings = await Booking.find({ organizationId: orgId })
        .populate('customerId', 'name phone')
        .populate('propertyId', 'title unitNumber')
        .lean();

      csvContent = 'Booking Ref,Customer Name,Customer Phone,Property Title,Unit No,Agreed Price,Total Paid,Balance Due,Status,Booking Date\n';
      bookings.forEach((b) => {
        csvContent += `"${b.bookingReference}","${b.customerId?.name || ''}","${b.customerId?.phone || ''}","${b.propertyId?.title || ''}","${b.propertyId?.unitNumber || ''}",${b.agreedPrice},${b.totalPaid},${b.balanceDue},"${b.status}","${b.bookingDate.toISOString()}"\n`;
      });
    } else if (type === 'payments') {
      const payments = await Payment.find({ organizationId: orgId })
        .populate('customerId', 'name')
        .lean();

      csvContent = 'Payment Ref,Customer,Amount,Payment Method,Payment Type,Reference No,Status,Payment Date\n';
      payments.forEach((p) => {
        csvContent += `"${p.paymentReference}","${p.customerId?.name || ''}",${p.amount},"${p.paymentMethod}","${p.paymentType}","${p.transactionReference || ''}","${p.status}","${p.paymentDate.toISOString()}"\n`;
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid report export type' });
    }

    res.header('Content-Type', 'text/csv');
    res.attachment(fileName);
    return res.send(csvContent);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getReportsSummary,
  exportReportCSV,
};
