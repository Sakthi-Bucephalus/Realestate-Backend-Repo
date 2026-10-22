const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.CUSTOMERS));

router.get('/', requirePermission('customers.view'), customerController.getCustomers);
router.get('/:id', requirePermission('customers.view'), customerController.getCustomerById);
router.post('/', requirePermission('customers.create'), customerController.createCustomer);
router.put('/:id', requirePermission('customers.edit'), customerController.updateCustomer);
router.delete('/:id', requirePermission('customers.delete'), customerController.deleteCustomer);

module.exports = router;
