const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.LEADS));

// 1. Static and summary routes (placed before parameter routes)
router.get('/stream', leadController.streamLeads);
router.get('/summary/stats', requirePermission('leads.view'), leadController.getLeadsSummaryStats);
router.get('/export/csv', requirePermission('leads.export'), leadController.exportLeadsCSV);
router.get('/kanban', requirePermission('leads.view'), leadController.getKanbanLeads);
router.get('/', requirePermission('leads.view'), leadController.getLeads);

// 2. Action and resource modification routes
router.post('/', requirePermission('leads.create'), leadController.createLead);
router.get('/:id', requirePermission('leads.view'), leadController.getLeadById);
router.put('/:id', requirePermission('leads.edit'), leadController.updateLead);
router.patch('/:id/status', requirePermission('leads.edit'), leadController.updateLeadStatus);
router.patch('/:id/review', requirePermission('leads.edit'), leadController.markLeadReviewed);
router.post('/:id/call', requirePermission('leads.edit'), leadController.logCallAction);
router.post('/:id/follow-up', requirePermission('leads.edit'), leadController.addFollowUp);
router.post('/:id/complete-follow-up', requirePermission('leads.edit'), leadController.completeFollowUp);
router.post('/:id/convert', requirePermission('leads.edit'), leadController.convertLeadToCustomer);
router.delete('/:id', requirePermission('leads.delete'), leadController.deleteLead);

module.exports = router;
