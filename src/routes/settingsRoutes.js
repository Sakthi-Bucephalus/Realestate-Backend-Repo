const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { ROLES } = require('../constants/roles');

router.use(requireAuth);

router.get('/profile', settingsController.getOrgSettings);
router.put('/profile', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN), settingsController.updateOrgProfile);

// SMTP configuration (MD only)
router.post('/smtp', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.OWNER), settingsController.saveSmtpSettings);
router.post('/smtp/test', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN), settingsController.testSmtpSettings);

// Module Access Control
router.get('/module-access', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN), settingsController.getModuleAccessControl);
router.patch('/modules/toggle', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.OWNER), settingsController.updateEnabledModules);
router.put('/module-access/role', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.OWNER), settingsController.updateRolePermissions);

// Audit logs (MD can view all; Directors/Admins if permitted)
router.get('/audit-logs', requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN), settingsController.getAuditLogs);

module.exports = router;
