const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

// Public endpoints
router.get('/check-setup', authController.checkSetup);

// Initial MD Registration with Email OTP
router.post('/register-md', authController.registerInitialMD);
router.post('/verify-md-otp', authController.verifyInitialMDOtp);
router.post('/resend-md-otp', authController.resendInitialMDOtp);

// Legacy bootstrap & demo seed
router.post('/bootstrap', authController.bootstrapOwner);
router.post('/seed-demo', authController.seedDemoData);

// Login & General OTP
router.post('/login', authController.login);
router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtpHandler);
router.post('/reset-password', authController.resetPassword);

// Authenticated endpoints
router.get('/me', requireAuth, authController.getMe);
router.put('/change-password', requireAuth, authController.changePassword);

module.exports = router;
