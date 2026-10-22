const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');
const { requireModule } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.DASHBOARD));

router.get('/stats', dashboardController.getDashboardStats);

module.exports = router;
