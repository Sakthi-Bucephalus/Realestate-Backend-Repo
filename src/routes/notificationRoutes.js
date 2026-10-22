const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { ROLES } = require('../constants/roles');

router.use(requireAuth);

router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markAsRead);
router.post('/mark-all-read', notificationController.markAllAsRead);

// Durable job history & retry
router.get('/jobs', requireRole(ROLES.OWNER, ROLES.ADMIN), notificationController.getNotificationJobs);
router.post('/jobs/:id/retry', requireRole(ROLES.OWNER, ROLES.ADMIN), notificationController.retryJob);

module.exports = router;
