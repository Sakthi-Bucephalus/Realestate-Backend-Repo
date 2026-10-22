const express = require('express');
const router = express.Router();
const siteVisitController = require('../controllers/siteVisitController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.SITE_VISITS));

router.get('/', requirePermission('site_visits.view'), siteVisitController.getSiteVisits);
router.post('/', requirePermission('site_visits.create'), siteVisitController.createSiteVisit);
router.put('/:id', requirePermission('site_visits.edit'), siteVisitController.updateSiteVisit);
router.post('/:id/cancel', requirePermission('site_visits.edit'), siteVisitController.cancelSiteVisit);

module.exports = router;
