const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.REPORTS));

router.get('/summary', requirePermission('reports.view'), reportController.getReportsSummary);
router.get('/export/:type', requirePermission('reports.export'), reportController.exportReportCSV);

module.exports = router;
