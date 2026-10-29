const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const metaWebhookController = require('../controllers/metaWebhookController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

// 1. Public Meta Webhook Endpoints (Called directly by Meta Graph API servers)
router.get('/webhook', metaWebhookController.verifyWebhook);
router.post('/webhook', metaWebhookController.handleWebhookEvent);

// Public Facebook OAuth Redirect Fallback (if Facebook redirects browser to backend instead of SPA)
router.get('/connect/callback', metaController.handleOAuthGetRedirect);
router.get('/connect-meta/callback', metaController.handleOAuthGetRedirect);
router.get('/callback', metaController.handleOAuthGetRedirect);

// 2. Authenticated CRM Meta Integration Management Endpoints
router.use(requireAuth);

router.get('/config', requirePermission('leads.view'), metaController.getConnectionConfig);
router.get('/connect/url', requirePermission('leads.edit'), metaController.getConnectUrl);
router.post('/connect/callback', requirePermission('leads.edit'), metaController.handleOAuthCallback);
router.get('/connection', requirePermission('leads.view'), metaController.getConnection);
router.get('/pages', requirePermission('leads.view'), metaController.refreshPagesAndForms);
router.post('/select-resources', requirePermission('leads.edit'), metaController.updateSelectedResources);
router.post('/subscribe-page', requirePermission('leads.edit'), metaController.subscribePage);
router.post('/sync', requirePermission('leads.edit'), metaController.triggerSync);
router.get('/health', requirePermission('leads.view'), metaController.testConnectionHealth);
router.post('/disconnect', requirePermission('leads.edit'), metaController.disconnect);

module.exports = router;
