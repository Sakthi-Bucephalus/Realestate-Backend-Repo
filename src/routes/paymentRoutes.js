const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.PAYMENTS));

router.get('/', requirePermission('payments.view'), paymentController.getPayments);
router.get('/:id/receipt', requirePermission('payments.view'), paymentController.getReceiptData);
router.post('/', requirePermission('payments.create'), paymentController.recordPayment);
router.post('/:id/reverse', requirePermission('payments.edit'), paymentController.reversePayment);

module.exports = router;
