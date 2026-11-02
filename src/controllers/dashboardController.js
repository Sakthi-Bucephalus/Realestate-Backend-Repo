const Lead = require('../models/Lead');
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const SiteVisit = require('../models/SiteVisit');
const Customer = require('../models/Customer');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { ROLES, isManagingDirectorRole } = require('../constants/roles');
const { LEAD_STATUSES, PROPERTY_AVAILABILITY, BOOKING_STATUSES } = require('../constants/statuses');
const { buildDataScopeQuery } = require('../utils/dataScope');

const getDashboardStats = async (req, res, next) => {
  try {
    const orgId = req.organizationId;
    const isMD = isManagingDirectorRole(req.user.role);

    // Build data-scoped query filters for the current role
    const leadScopeQuery = buildDataScopeQuery(req.user, 'leads');
    const visitScopeQuery = buildDataScopeQuery(req.user, 'site_visits');
    const bookingScopeQuery = buildDataScopeQuery(req.user, 'bookings');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Parallel aggregation pipelines
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
      mdUserStats,
      recentAuditLogs,
    ] = await Promise.all([
      // Total leads (scoped)
      Lead.countDocuments({ ...leadScopeQuery }),

      // New inquiries this month (scoped)
      Lead.countDocuments({
        ...leadScopeQuery,
        createdAt: { $gte: startOfMonth },
      }),

      // Converted leads (scoped)
      Lead.countDocuments({
        ...leadScopeQuery,
        status: LEAD_STATUSES.CONVERTED,
      }),

      // Follow-ups due today (scoped)
      Lead.countDocuments({
        ...leadScopeQuery,
        nextFollowUpDate: { $gte: startOfToday, $lte: endOfToday },
        status: { $nin: [LEAD_STATUSES.CONVERTED, LEAD_STATUSES.LOST] },
      }),

      // Overdue follow-ups (scoped)
      Lead.countDocuments({
        ...leadScopeQuery,
        nextFollowUpDate: { $lt: startOfToday },
        status: { $nin: [LEAD_STATUSES.CONVERTED, LEAD_STATUSES.LOST] },
      }),

      // Upcoming site visits in next 7 days (scoped)
      SiteVisit.countDocuments({
        ...visitScopeQuery,
        scheduledTime: { $gte: startOfToday, $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
        status: 'Scheduled',
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

      // Booking statistics (scoped)
      Booking.aggregate([
        {
          $match: {
            ...bookingScopeQuery,
            status: { $ne: BOOKING_STATUSES.CANCELLED },
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

      // Lead stage breakdown for pipeline chart (scoped)
      Lead.aggregate([
        { $match: { ...leadScopeQuery } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Monthly sales trends for the last 6 months
      Booking.aggregate([
        {
          $match: {
            ...bookingScopeQuery,
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

      // MD Organization-Wide User Stats (if MD or Director)
      (isMD || req.user.role === ROLES.DIRECTOR)
        ? Promise.all([
            User.countDocuments({ organizationId: orgId }),
            User.countDocuments({ organizationId: orgId, isActive: true }),
            User.aggregate([
              { $match: { organizationId: orgId } },
              { $group: { _id: '$role', count: { $sum: 1 } } },
            ]),
          ])
        : Promise.resolve(null),

      // MD Recent Administrative Activities (if MD or Director)
      (isMD || req.user.role === ROLES.DIRECTOR)
        ? AuditLog.find({ organizationId: orgId })
            .sort({ createdAt: -1 })
            .limit(6)
            .lean()
        : Promise.resolve([]),
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

    // Role-wise user statistics for MD
    let userManagementKpis = null;
    if (mdUserStats) {
      const [totalUsers, activeUsers, roleAgg] = mdUserStats;
      userManagementKpis = {
        totalUsers,
        activeUsers,
        roleCounts: Object.fromEntries(roleAgg.map((r) => [r._id, r.count])),
      };
    }

    return res.json({
      success: true,
      data: {
        role: req.user.role,
        isMD,
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
        userManagementKpis,
        recentActivities: recentAuditLogs || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardStats,
};
