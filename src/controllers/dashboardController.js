const Lead = require('../models/Lead');
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const SiteVisit = require('../models/SiteVisit');
const Customer = require('../models/Customer');
const { ROLES } = require('../constants/roles');
const { LEAD_STATUSES, PROPERTY_AVAILABILITY, BOOKING_STATUSES } = require('../constants/statuses');

const getDashboardStats = async (req, res, next) => {
  try {
    const orgId = req.organizationId;
    const isEmployee = req.user.role === ROLES.EMPLOYEE;
    const employeeFilter = isEmployee ? { assignedTo: req.user._id } : {};

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Run parallel aggregation pipelines
    const [
      totalLeads,
      newLeadsMonth,
      convertedLeads,
      dueTodayFollowUps,
      overdueFollowUps,
      upcomingVisits,
      propertyStats,
      bookingStats,
      paymentStats,
      stageBreakdown,
      monthlySalesTrends,
    ] = await Promise.all([
      // Total leads
      Lead.countDocuments({ organizationId: orgId, ...employeeFilter }),

      // New inquiries this month
      Lead.countDocuments({
        organizationId: orgId,
        createdAt: { $gte: startOfMonth },
        ...employeeFilter,
      }),

      // Converted leads
      Lead.countDocuments({
        organizationId: orgId,
        status: LEAD_STATUSES.CONVERTED,
        ...employeeFilter,
      }),

      // Follow-ups due today
      Lead.countDocuments({
        organizationId: orgId,
        nextFollowUpDate: { $gte: startOfToday, $lte: endOfToday },
        status: { $nin: [LEAD_STATUSES.CONVERTED, LEAD_STATUSES.LOST] },
        ...employeeFilter,
      }),

      // Overdue follow-ups
      Lead.countDocuments({
        organizationId: orgId,
        nextFollowUpDate: { $lt: startOfToday },
        status: { $nin: [LEAD_STATUSES.CONVERTED, LEAD_STATUSES.LOST] },
        ...employeeFilter,
      }),

      // Upcoming site visits in next 7 days
      SiteVisit.countDocuments({
        organizationId: orgId,
        scheduledTime: { $gte: startOfToday, $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
        status: 'Scheduled',
        ...employeeFilter,
      }),

      // Property inventory breakdown
      Property.aggregate([
        { $match: { organizationId: orgId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$pricing.basePrice' },
          },
        },
      ]),

      // Booking statistics
      Booking.aggregate([
        {
          $match: {
            organizationId: orgId,
            status: { $ne: BOOKING_STATUSES.CANCELLED },
            ...(isEmployee ? { assignedTo: req.user._id } : {}),
          },
        },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            totalAgreedPrice: { $sum: '$agreedPrice' },
            totalPaid: { $sum: '$totalPaid' },
            totalBalanceDue: { $sum: '$balanceDue' },
          },
        },
      ]),

      // Payment collections this month
      Payment.aggregate([
        {
          $match: {
            organizationId: orgId,
            isReversed: false,
            paymentDate: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            collectedThisMonth: { $sum: '$amount' },
          },
        },
      ]),

      // Lead stage breakdown for pipeline chart
      Lead.aggregate([
        { $match: { organizationId: orgId, ...employeeFilter } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Monthly sales trends for the last 6 months
      Booking.aggregate([
        {
          $match: {
            organizationId: orgId,
            status: { $in: [BOOKING_STATUSES.CONFIRMED, BOOKING_STATUSES.COMPLETED] },
            bookingDate: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$bookingDate' },
              month: { $month: '$bookingDate' },
            },
            volume: { $sum: 1 },
            totalRevenue: { $sum: '$agreedPrice' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    // Format property inventory breakdown
    const inventory = {
      available: 0,
      reserved: 0,
      sold: 0,
      total: 0,
    };

    propertyStats.forEach((p) => {
      const count = p.count;
      inventory.total += count;
      if (p._id === PROPERTY_AVAILABILITY.AVAILABLE) inventory.available = count;
      if (p._id === PROPERTY_AVAILABILITY.RESERVED) inventory.reserved = count;
      if (p._id === PROPERTY_AVAILABILITY.SOLD) inventory.sold = count;
    });

    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;
    const bStats = bookingStats[0] || { totalBookings: 0, totalAgreedPrice: 0, totalPaid: 0, totalBalanceDue: 0 };
    const pStats = paymentStats[0] || { collectedThisMonth: 0 };

    // Format 6-month sales trend with month names
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedTrends = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const match = monthlySalesTrends.find((t) => t._id.year === y && t._id.month === m);

      formattedTrends.push({
        label: `${monthNames[m - 1]} ${String(y).slice(-2)}`,
        bookings: match ? match.volume : 0,
        revenue: match ? match.totalRevenue : 0,
      });
    }

    return res.json({
      success: true,
      data: {
        kpis: {
          totalLeads,
          newLeadsMonth,
          convertedLeads,
          conversionRate: Number(conversionRate),
          dueTodayFollowUps,
          overdueFollowUps,
          upcomingVisits,
          totalBookings: bStats.totalBookings,
          totalSalesValue: bStats.totalAgreedPrice,
          totalCollected: bStats.totalPaid,
          collectedThisMonth: pStats.collectedThisMonth,
          outstandingBalance: bStats.totalBalanceDue,
        },
        inventory,
        stageBreakdown: Object.fromEntries(stageBreakdown.map((s) => [s._id, s.count])),
        salesTrends: formattedTrends,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardStats,
};
