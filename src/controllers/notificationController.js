const Notification = require('../models/Notification');
const NotificationJob = require('../models/NotificationJob');
const { ROLES } = require('../constants/roles');

// 1. Get current user's notifications
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;

    const query = {
      organizationId: req.organizationId,
      recipientId: req.user._id,
    };

    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({
        organizationId: req.organizationId,
        recipientId: req.user._id,
        isRead: false,
      }),
    ]);

    return res.json({
      success: true,
      data: notifications,
      unreadCount,
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

// 2. Mark single notification as read
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipientId: req.user._id,
      },
      {
        $set: { isRead: true, readAt: new Date() },
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    return res.json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
};

// 3. Mark all notifications as read
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      {
        organizationId: req.organizationId,
        recipientId: req.user._id,
        isRead: false,
      },
      {
        $set: { isRead: true, readAt: new Date() },
      }
    );

    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
};

// 4. Get durable notification jobs status & failed queue (Owner / Admin)
const getNotificationJobs = async (req, res, next) => {
  try {
    const { status = '' } = req.query;
    const query = { organizationId: req.organizationId };

    if (status) query.status = status;

    const jobs = await NotificationJob.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
};

// 5. Retry eligible failed notification job
const retryJob = async (req, res, next) => {
  try {
    const job = await NotificationJob.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    job.status = 'QUEUED';
    job.attemptCount = 0;
    job.nextRunAt = new Date();
    job.lastError = '';
    await job.save();

    return res.json({ success: true, message: 'Job queued for immediate retry', data: job });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getNotificationJobs,
  retryJob,
};
