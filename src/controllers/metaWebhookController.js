/**
 * Meta Lead Ads Webhook Controller
 * Handles subscription verification and real-time lead event notifications
 */

const { verifyMetaSignature } = require('../utils/crypto');
const { processWebhookLeadgenEntry } = require('../services/metaSyncService');

/**
 * 1. Meta Webhook Subscription Verification (GET /api/meta/webhook)
 * Responds to Meta challenge handshake when configuring webhooks in Meta App Dashboard
 */
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken =
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.FB_WEBHOOK_VERIFY_TOKEN ||
    'estateflow_meta_webhook_verify_token_secure_2026';

  console.log(`[MetaWebhook] Verification attempt received. Mode: ${mode}`);

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[MetaWebhook] Verification successful. Responding with challenge.');
    // Must return challenge as plain text with 200 OK
    return res.status(200).send(challenge);
  }

  // Gracefully handle case if Facebook OAuth redirect was mistakenly sent to Webhook URL
  if (req.query.code && !mode) {
    console.warn('[MetaWebhook] Detected Facebook OAuth code sent to Webhook URL endpoint. Redirecting to frontend callback...');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const queryParams = new URLSearchParams(req.query).toString();
    return res.redirect(`${frontendUrl.replace(/\/+$/, '')}/connect-meta/callback?${queryParams}`);
  }

  console.warn('[MetaWebhook] Verification failed. Token mismatch or invalid mode.');
  return res.status(403).json({
    success: false,
    message: 'Webhook subscription verification token mismatch.',
  });
};

/**
 * 2. Meta Webhook Event Delivery (POST /api/meta/webhook)
 * Receives real-time leadgen change events from Meta Lead Ads
 */
const handleWebhookEvent = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;

  // Optional signature verification if app secret is configured
  if (appSecret && signature) {
    const rawPayload = req.rawBody || req.body;
    const isValid = verifyMetaSignature(rawPayload, signature, appSecret);
    if (!isValid) {
      console.warn('[MetaWebhook] Signature verification failed for webhook delivery.');
      return res.status(401).json({ success: false, message: 'Invalid payload signature.' });
    }
  }

  const payload = req.body;

  // Acknowledge receipt to Meta immediately (must respond within 20s to prevent retries)
  res.status(200).json({ success: true, message: 'EVENT_RECEIVED' });

  // Process lead events asynchronously in background
  if (payload.object === 'page' && Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      const pageId = entry.id;
      const changes = entry.changes || [];

      for (const change of changes) {
        if (change.field === 'leadgen' && change.value) {
          const {
            leadgen_id,
            form_id,
            created_time,
            ad_id,
            page_id = pageId,
          } = change.value;

          console.log(`[MetaWebhook] Processing leadgen event: lead=${leadgen_id}, page=${page_id}, form=${form_id}`);

          // Trigger background retrieval and persistence with error boundary
          processWebhookLeadgenEntry({
            pageId: String(page_id || pageId),
            formId: String(form_id || ''),
            leadgenId: String(leadgen_id),
            createdTime: created_time,
            adId: String(ad_id || ''),
            eventId: `wh_${leadgen_id}_${entry.time || Date.now()}`,
          }).catch((err) => {
            console.error(`[MetaWebhook] Async background processing error for lead ${leadgen_id}:`, err.message);
          });
        }
      }
    }
  }
};

module.exports = {
  verifyWebhook,
  handleWebhookEvent,
};
