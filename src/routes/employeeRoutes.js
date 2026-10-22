const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission, requireRole } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');
const { ROLES } = require('../constants/roles');

router.use(requireAuth);
router.use(requireModule(MODULES.EMPLOYEES));

router.get('/', requirePermission('employees.view'), employeeController.getEmployees);
router.post('/', requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.HR), employeeController.createEmployee);
router.put('/:id', requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.HR), employeeController.updateEmployee);
router.patch('/:id/status', requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.HR), employeeController.toggleAccountStatus);

module.exports = router;
