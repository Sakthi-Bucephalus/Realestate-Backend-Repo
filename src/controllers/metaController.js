/**
 * Meta Account Connection & Resource Management Controller
 * EstateFlow CRM - Multi-Tenant Meta Integration
 */

const MetaConnection = require('../models/MetaConnection');
const { encrypt, decrypt, generateOAuthState, verifyOAuthState } = require('../utils/crypto');
const metaService = require('../services/metaService');
const metaSyncService = require('../services/metaSyncService');
const { logAudit } = require('../services/auditService');

/**
 * 1. Get OAuth Initiation URL with secure CSRF state
 */
const getConnectUrl = async (req, res, next) => {
  try {
    const appId = process.env.META_APP_ID;
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: 'META_APP_ID is not configured in backend environment variables.',
        instructions: 'Please configure META_APP_ID and META_APP_SECRET in the .env file.',
      });
    }

    const state = generateOAuthState(req.organizationId, req.user._id);
    const authUrl = metaService.getOAuthUrl(state);

    return res.json({
      success: true,
      authUrl,
      state,
      appId,
      graphVersion: metaService.getGraphApiVersion(),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 2. Handle OAuth Callback: exchange code, retrieve pages & forms, persist connection
 */
const handleOAuthCallback = async (req, res, next) => {
  try {
    const { code, state, redirectUri } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Authorization code is required' });
    }

    // Verify CSRF state
    if (state) {
      const stateData = verifyOAuthState(state);
      if (!stateData) {
        return res.status(403).json({ success: false, message: 'Invalid or expired OAuth state token (CSRF protection failed).' });
      }
      if (String(stateData.organizationId) !== String(req.organizationId)) {
        return res.status(403).json({ success: false, message: 'OAuth state does not match your active organization session.' });
      }
    }

    // Exchange code for long-lived tokens
    console.log('[MetaConnect] Exchanging OAuth code for tokens...');
    const tokenResult = await metaService.exchangeCodeForTokens(code, redirectUri);
    const { accessToken, expiresAt, userProfile } = tokenResult;

    // Fetch user Pages
    console.log('[MetaConnect] Retrieving managed Facebook Pages...');
    const pages = await metaService.getUserPages(accessToken);

    // Fetch Forms for each page & attempt webhook subscription
    const pageConfigs = [];
    for (const page of pages) {
      let forms = [];
      let isSubscribed = false;

      try {
        forms = await metaService.getPageLeadForms(page.pageId, page.pageAccessToken);
      } catch (fErr) {
        console.warn(`[MetaConnect] Could not fetch forms for page ${page.pageName}:`, fErr.message);
      }

      try {
        await metaService.subscribePageWebhook(page.pageId, page.pageAccessToken);
        isSubscribed = true;
        console.log(`[MetaConnect] Successfully subscribed webhook for page: ${page.pageName}`);
      } catch (subErr) {
        console.warn(`[MetaConnect] Auto-subscribe webhook failed for page ${page.pageName}:`, subErr.message);
      }

      pageConfigs.push({
        pageId: page.pageId,
        pageName: page.pageName,
        pageCategory: page.pageCategory,
        encryptedPageAccessToken: encrypt(page.pageAccessToken),
        isSubscribedToWebhook: isSubscribed,
        webhookSubscribedAt: isSubscribed ? new Date() : null,
        isSelected: true,
        forms: forms.map((f) => ({
          formId: f.formId,
          formName: f.formName,
          status: f.status,
          leadsCount: f.leadsCount,
          isSelected: true,
        })),
      });
    }

    // Upsert MetaConnection for organization
    let connection = await MetaConnection.findOne({ organizationId: req.organizationId });

    if (!connection) {
      connection = new MetaConnection({
        organizationId: req.organizationId,
        connectedBy: req.user._id,
      });
    }

    connection.connectedBy = req.user._id;
    connection.facebookUserId = userProfile.id;
    connection.facebookUserName = userProfile.name || 'Facebook User';
    connection.facebookUserEmail = userProfile.email || '';
    connection.encryptedUserAccessToken = encrypt(accessToken);
    connection.userAccessTokenExpiresAt = expiresAt;
    connection.selectedPages = pageConfigs;
    connection.status = 'CONNECTED';
    connection.healthStatus = 'HEALTHY';
    connection.healthDetails = 'Operational and verified via Facebook Login';
    connection.lastHealthCheckAt = new Date();
    connection.appId = process.env.META_APP_ID || '';
    connection.metaGraphVersion = metaService.getGraphApiVersion();

    await connection.save();

    await logAudit({
      organizationId: req.organizationId,
      action: 'META_ACCOUNT_CONNECTED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'MetaConnection',
      entityId: connection._id,
      details: {
        facebookUserName: connection.facebookUserName,
        facebookUserId: connection.facebookUserId,
        pagesCount: pageConfigs.length,
      },
      req,
    });

    return res.json({
      success: true,
      message: 'Meta account successfully connected with Facebook Lead Ads!',
      data: sanitizeConnection(connection),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 3. Get current Meta Connection details
 */
const getConnection = async (req, res, next) => {
  try {
    const connection = await MetaConnection.findOne({ organizationId: req.organizationId });

    if (!connection) {
      return res.json({
        success: true,
        data: {
          status: 'DISCONNECTED',
          healthStatus: 'UNCHECKED',
          selectedPages: [],
        },
      });
    }

    return res.json({
      success: true,
      data: sanitizeConnection(connection),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 4. Refresh accessible Pages and Forms from Meta
 */
const refreshPagesAndForms = async (req, res, next) => {
  try {
    const connection = await MetaConnection.findOne({ organizationId: req.organizationId }).select('+encryptedUserAccessToken +selectedPages.encryptedPageAccessToken');

    if (!connection || connection.status === 'DISCONNECTED') {
      return res.status(400).json({ success: false, message: 'No active Meta connection found' });
    }

    const userToken = decrypt(connection.encryptedUserAccessToken);
    if (!userToken) {
      return res.status(401).json({ success: false, message: 'Decryption failed for stored user token. Please reconnect.' });
    }

    const pages = await metaService.getUserPages(userToken);
    const updatedPages = [];

    for (const page of pages) {
      const existing = connection.selectedPages.find((p) => p.pageId === page.pageId);
      let forms = [];

      try {
        forms = await metaService.getPageLeadForms(page.pageId, page.pageAccessToken);
      } catch (fErr) {
        console.warn(`[MetaConnect] Error refreshing forms for ${page.pageName}:`, fErr.message);
      }

      updatedPages.push({
        pageId: page.pageId,
        pageName: page.pageName,
        pageCategory: page.pageCategory,
        encryptedPageAccessToken: encrypt(page.pageAccessToken),
        isSubscribedToWebhook: existing ? existing.isSubscribedToWebhook : false,
        webhookSubscribedAt: existing ? existing.webhookSubscribedAt : null,
        isSelected: existing ? existing.isSelected : true,
        forms: forms.map((f) => ({
          formId: f.formId,
          formName: f.formName,
          status: f.status,
          leadsCount: f.leadsCount,
          isSelected: true,
        })),
      });
    }

    connection.selectedPages = updatedPages;
    connection.lastHealthCheckAt = new Date();
    await connection.save();

    return res.json({
      success: true,
      message: 'Pages and Lead Forms refreshed from Meta',
      data: sanitizeConnection(connection),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 5. Update Selected Pages and Lead Forms
 */
const updateSelectedResources = async (req, res, next) => {
  try {
    const { pages } = req.body; // Array of { pageId, isSelected, forms: [{ formId, isSelected }] }

    const connection = await MetaConnection.findOne({ organizationId: req.organizationId }).select('+selectedPages.encryptedPageAccessToken');

    if (!connection) {
      return res.status(404).json({ success: false, message: 'Meta connection not found' });
    }

    if (Array.isArray(pages)) {
      for (const update of pages) {
        const targetPage = connection.selectedPages.find((p) => p.pageId === update.pageId);
        if (targetPage) {
          if (update.isSelected !== undefined) {
            targetPage.isSelected = Boolean(update.isSelected);
          }

          if (Array.isArray(update.forms)) {
            for (const fUpdate of update.forms) {
              const targetForm = targetPage.forms.find((f) => f.formId === fUpdate.formId);
              if (targetForm && fUpdate.isSelected !== undefined) {
                targetForm.isSelected = Boolean(fUpdate.isSelected);
              }
            }
          }
        }
      }
    }

    await connection.save();

    return res.json({
      success: true,
      message: 'Resource configuration updated',
      data: sanitizeConnection(connection),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 6. Subscribe specific Facebook Page to Meta Leadgen Webhook
 */
const subscribePage = async (req, res, next) => {
  try {
    const { pageId } = req.body;
    const connection = await MetaConnection.findOne({ organizationId: req.organizationId }).select('+selectedPages.encryptedPageAccessToken');

    if (!connection) {
      return res.status(404).json({ success: false, message: 'Meta connection not found' });
    }

    const page = connection.selectedPages.find((p) => p.pageId === pageId);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found in this connection' });
    }

    const pageAccessToken = decrypt(page.encryptedPageAccessToken);
    if (!pageAccessToken) {
      return res.status(400).json({ success: false, message: 'Unable to decrypt Page Access Token' });
    }

    await metaService.subscribePageWebhook(page.pageId, pageAccessToken);

    page.isSubscribedToWebhook = true;
    page.webhookSubscribedAt = new Date();
    await connection.save();

    return res.json({
      success: true,
      message: `Successfully subscribed page "${page.pageName}" to Meta Lead Ads webhook`,
      data: sanitizeConnection(connection),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 7. Trigger Manual Reconciliation & Sync of Missed Leads
 */
const triggerSync = async (req, res, next) => {
  try {
    const { formId, limit = 50 } = req.body;

    if (!formId) {
      return res.status(400).json({ success: false, message: 'formId is required for lead synchronization' });
    }

    const result = await metaSyncService.syncFormLeads(req.organizationId, formId, parseInt(limit, 10) || 50);

    return res.json({
      success: true,
      message: `Sync completed: ${result.newlyCreated} new leads imported, ${result.existingUpdated} existing checked.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 8. Connection Health Check
 */
const testConnectionHealth = async (req, res, next) => {
  try {
    const connection = await MetaConnection.findOne({ organizationId: req.organizationId }).select('+encryptedUserAccessToken');

    if (!connection || connection.status === 'DISCONNECTED') {
      return res.json({
        success: true,
        data: {
          isValid: false,
          healthStatus: 'DISCONNECTED',
          message: 'No active connection is currently configured.',
        },
      });
    }

    const userToken = decrypt(connection.encryptedUserAccessToken);
    if (!userToken) {
      connection.healthStatus = 'ERROR';
      connection.healthDetails = 'Decryption failed for stored user token';
      await connection.save();
      return res.json({
        success: true,
        data: {
          isValid: false,
          healthStatus: 'ERROR',
          message: 'Stored credentials cannot be decrypted. Please reconnect.',
        },
      });
    }

    const health = await metaService.checkTokenHealth(userToken);

    connection.lastHealthCheckAt = new Date();
    connection.healthStatus = health.isValid ? 'HEALTHY' : 'NEEDS_REAUTHORIZATION';
    connection.healthDetails = health.message;
    if (!health.isValid) {
      connection.status = 'NEEDS_REAUTHORIZATION';
    }
    await connection.save();

    return res.json({
      success: true,
      data: {
        isValid: health.isValid,
        healthStatus: connection.healthStatus,
        message: health.message,
        expiresAt: health.expiresAt,
        scopes: health.scopes,
        lastHealthCheckAt: connection.lastHealthCheckAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 9. Disconnect Meta Account
 */
const disconnect = async (req, res, next) => {
  try {
    const connection = await MetaConnection.findOne({ organizationId: req.organizationId }).select('+selectedPages.encryptedPageAccessToken');

    if (connection) {
      // Unsubscribe pages from webhook
      for (const page of connection.selectedPages) {
        if (page.encryptedPageAccessToken) {
          try {
            const pageToken = decrypt(page.encryptedPageAccessToken);
            if (pageToken) {
              await metaService.unsubscribePageWebhook(page.pageId, pageToken);
            }
          } catch (unsubErr) {
            console.warn(`[MetaConnect] Unsubscribe warning for ${page.pageName}:`, unsubErr.message);
          }
        }
      }

      connection.status = 'DISCONNECTED';
      connection.healthStatus = 'UNCHECKED';
      connection.healthDetails = 'Disconnected by user';
      connection.encryptedUserAccessToken = encrypt('DISCONNECTED');
      connection.selectedPages = [];
      await connection.save();

      await logAudit({
        organizationId: req.organizationId,
        action: 'META_ACCOUNT_DISCONNECTED',
        performedBy: req.user._id,
        performedByName: `${req.user.firstName} ${req.user.lastName}`,
        entityType: 'MetaConnection',
        entityId: connection._id,
        req,
      });
    }

    return res.json({
      success: true,
      message: 'Meta account successfully disconnected',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Helper: Strip confidential fields (tokens) before sending to client
 */
const sanitizeConnection = (connection) => {
  const obj = connection.toObject ? connection.toObject() : { ...connection };
  delete obj.encryptedUserAccessToken;
  if (Array.isArray(obj.selectedPages)) {
    obj.selectedPages = obj.selectedPages.map((page) => {
      const p = { ...page };
      delete p.encryptedPageAccessToken;
      return p;
    });
  }
  return obj;
};

module.exports = {
  getConnectUrl,
  handleOAuthCallback,
  getConnection,
  refreshPagesAndForms,
  updateSelectedResources,
  subscribePage,
  triggerSync,
  testConnectionHealth,
  disconnect,
};
