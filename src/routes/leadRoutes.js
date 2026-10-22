const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.LEADS));

router.get('/', requirePermission('leads.view'), leadController.getLeads);
router.get('/kanban', requirePermission('leads.view'), leadController.getKanbanLeads);
router.get('/:id', requirePermission('leads.view'), leadController.getLeadById);
router.post('/', requirePermission('leads.create'), leadController.createLead);
router.put('/:id', requirePermission('leads.edit'), leadController.updateLead);
router.post('/:id/follow-up', requirePermission('leads.edit'), leadController.addFollowUp);
router.post('/:id/complete-follow-up', requirePermission('leads.edit'), leadController.completeFollowUp);
router.post('/:id/convert', requirePermission('leads.edit'), leadController.convertLeadToCustomer);
router.delete('/:id', requirePermission('leads.delete'), leadController.deleteLead);

module.exports = router;
