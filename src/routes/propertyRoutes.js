const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const { requireAuth } = require('../middleware/auth');
const { requireModule, requirePermission } = require('../middleware/rbac');
const { MODULES } = require('../constants/modules');

router.use(requireAuth);
router.use(requireModule(MODULES.PROPERTIES));

router.get('/', requirePermission('properties.view'), propertyController.getProperties);
router.get('/:id', requirePermission('properties.view'), propertyController.getPropertyById);
router.post('/', requirePermission('properties.create'), propertyController.createProperty);
router.put('/:id', requirePermission('properties.edit'), propertyController.updateProperty);
router.delete('/:id', requirePermission('properties.delete'), propertyController.deleteProperty);

module.exports = router;
