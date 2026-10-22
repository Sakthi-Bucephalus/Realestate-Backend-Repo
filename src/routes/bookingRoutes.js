const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.BOOKINGS));

router.get('/', requirePermission('bookings.view'), bookingController.getBookings);
router.get('/:id', requirePermission('bookings.view'), bookingController.getBookingById);
router.post('/', requirePermission('bookings.create'), bookingController.createBooking);
router.post('/:id/confirm', requirePermission('bookings.edit'), bookingController.confirmBooking);
router.post('/:id/cancel', requirePermission('bookings.edit'), bookingController.cancelBooking);

module.exports = router;
