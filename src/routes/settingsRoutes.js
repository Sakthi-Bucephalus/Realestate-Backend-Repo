const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { ROLES } = require('../constants/roles');

router.use(requireAuth);

router.get('/profile', settingsController.getOrgSettings);
router.put('/profile', requireRole(ROLES.OWNER, ROLES.ADMIN), settingsController.updateOrgProfile);

// SMTP configuration
router.post('/smtp', requireRole(ROLES.OWNER), settingsController.saveSmtpSettings);
router.post('/smtp/test', requireRole(ROLES.OWNER, ROLES.ADMIN), settingsController.testSmtpSettings);

// Module Access Control
router.get('/module-access', requireRole(ROLES.OWNER, ROLES.ADMIN), settingsController.getModuleAccessControl);
router.patch('/modules/toggle', requireRole(ROLES.OWNER), settingsController.updateEnabledModules);
router.put('/module-access/role', requireRole(ROLES.OWNER), settingsController.updateRolePermissions);

// Audit logs
router.get('/audit-logs', requireRole(ROLES.OWNER, ROLES.ADMIN), settingsController.getAuditLogs);

module.exports = router;
