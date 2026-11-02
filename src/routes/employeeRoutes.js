const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission, requireRole } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');
const { ROLES } = require('../constants/roles');

router.use(requireAuth);
router.use(requireModule(MODULES.EMPLOYEES));

// List employees & users
router.get('/', requirePermission('employees.view'), employeeController.getEmployees);

// Create user
router.post(
  '/',
  requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN, ROLES.HR),
  employeeController.createEmployee
);

// Update user details, role, or hierarchy
router.put(
  '/:id',
  requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN, ROLES.HR),
  employeeController.updateEmployee
);

// Toggle account lifecycle status (active / suspended / deactivated)
router.patch(
  '/:id/status',
  requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN, ROLES.HR),
  employeeController.toggleAccountStatus
);

// Administrative Password Reset
router.post(
  '/:id/reset-password',
  requireRole(ROLES.MANAGING_DIRECTOR, ROLES.DIRECTOR, ROLES.OWNER, ROLES.ADMIN),
  employeeController.adminResetPassword
);

// Director Delegation Management (MD Only)
router.put(
  '/:id/delegate',
  requireRole(ROLES.MANAGING_DIRECTOR, ROLES.OWNER),
  employeeController.delegateDirectorPermissions
);

module.exports = router;
