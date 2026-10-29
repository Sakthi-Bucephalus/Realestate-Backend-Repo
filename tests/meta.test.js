const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const { setupTestDatabase } = require('./testHelper');
const { encrypt, decrypt, verifyMetaSignature, generateOAuthState, verifyOAuthState } = require('../src/utils/crypto');
const { parseLeadData, getWebhookUrl, getRedirectUri } = require('../src/services/metaService');
const Lead = require('../src/models/Lead');
const MetaConnection = require('../src/models/MetaConnection');

describe('Meta Lead Ads & Tracking Module Integration Tests', () => {
  let token;
  let testOrg;
  let testOwner;
  let createdLeadId;

  before(async () => {
    await connectDB();
    const data = await setupTestDatabase();
    testOrg = data.org;
    testOwner = data.owner;

    // Login as owner to obtain JWT
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@estateflow.com', password: 'Password@123' });

    token = loginRes.body.token;
  });

  after(async () => {
    await disconnectDB();
  });

  // 1. Encryption Utility Tests
  describe('Crypto & Security Utilities', () => {
    test('encrypt and decrypt should round-trip arbitrary tokens safely', () => {
      const secretToken = 'EAABsbCS1iZAUBAOPz987654321_secret_meta_access_token_xyz';
      const encrypted = encrypt(secretToken);

      assert.notEqual(encrypted, secretToken);
      assert.ok(encrypted.includes(':')); // Format iv:authTag:cipher

      const decrypted = decrypt(encrypted);
      assert.equal(decrypted, secretToken);
    });

    test('verifyMetaSignature should validate HMAC-SHA256 signatures correctly', () => {
      const crypto = require('crypto');
      const secret = 'test_app_secret_998877';
      const payload = { object: 'page', entry: [] };
      const rawString = JSON.stringify(payload);

      const validHash = crypto.createHmac('sha256', secret).update(rawString).digest('hex');
      const validHeader = `sha256=${validHash}`;

      assert.equal(verifyMetaSignature(rawString, validHeader, secret), true);
      assert.equal(verifyMetaSignature(rawString, 'sha256=invalid_hash_value', secret), false);
    });

    test('generateOAuthState and verifyOAuthState should protect against CSRF', () => {
      const state = generateOAuthState(testOrg._id, testOwner._id);
      const verified = verifyOAuthState(state);

      assert.ok(verified);
      assert.equal(String(verified.organizationId), String(testOrg._id));
      assert.equal(String(verified.userId), String(testOwner._id));

      // Altered state fails verification
      assert.equal(verifyOAuthState(state + 'tampered'), null);
    });
  });

  // 2. Meta Lead Data Parsing
  describe('Meta Field Data Parsing', () => {
    test('should extract contact details and custom questions accurately', () => {
      const rawPayload = {
        id: 'meta_leadgen_123456789',
        created_time: '2026-10-24T06:00:00+0000',
        campaign_name: 'Luxury Villas Q4 Campaign',
        form_id: 'form_98765',
        platform: 'fb',
        field_data: [
          { name: 'full_name', values: ['Jane Doe'] },
          { name: 'phone_number', values: ['+91 98765 43210'] },
          { name: 'email', values: ['jane.doe@example.com'] },
          { name: 'preferred_city', values: ['Bangalore North'] },
          { name: 'budget_range', values: ['7500000'] },
          { name: 'expected_possession', values: ['Immediate'] },
        ],
      };

      const parsed = parseLeadData(rawPayload);

      assert.equal(parsed.name, 'Jane Doe');
      assert.equal(parsed.phone, '+91 98765 43210');
      assert.equal(parsed.email, 'jane.doe@example.com');
      assert.equal(parsed.metaCampaignName, 'Luxury Villas Q4 Campaign');
      assert.equal(parsed.metaLeadId, 'meta_leadgen_123456789');
      assert.equal(parsed.budgetMax, 7500000);
      assert.equal(parsed.formAnswers.length, 6);
    });
  });

  // 3. Webhook Endpoints
  describe('Meta Webhook Verification & Receiving', () => {
    test('GET /api/meta/webhook - should succeed when challenge token matches', async () => {
      const challengeCode = '1158201444';
      const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'estateflow_meta_webhook_verify_token_secure_2026';

      const res = await request(app)
        .get('/api/meta/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': verifyToken,
          'hub.challenge': challengeCode,
        });

      assert.equal(res.status, 200);
      assert.equal(res.text, challengeCode);
    });

    test('GET /api/meta/webhook - should reject when token is incorrect', async () => {
      const res = await request(app)
        .get('/api/meta/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': '12345',
        });

      assert.equal(res.status, 403);
    });

    test('POST /api/meta/webhook - should immediately acknowledge event receipt with 200 OK', async () => {
      const res = await request(app)
        .post('/api/meta/webhook')
        .send({
          object: 'page',
          entry: [
            {
              id: 'page_12345',
              time: 1729750000,
              changes: [
                {
                  field: 'leadgen',
                  value: {
                    ad_id: 'ad_101',
                    form_id: 'form_202',
                    leadgen_id: 'lead_303',
                    page_id: 'page_12345',
                  },
                },
              ],
            },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.message, 'EVENT_RECEIVED');
    });
  });

  // 4. Leads Management & Track Your Leads Features
  describe('Track Your Leads APIs', () => {
    test('POST /api/leads - should create lead with Meta attribution fields', async () => {
      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sarah Connor',
          phone: '+91 98888 77777',
          email: 'sarah@example.com',
          source: 'Meta Lead Ads',
          priority: 'High',
          preferredPropertyType: 'Villa / House',
          budgetMin: 5000000,
          budgetMax: 8000000,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.name, 'Sarah Connor');
      assert.equal(res.body.data.source, 'Meta Lead Ads');
      createdLeadId = res.body.data._id;
    });

    test('GET /api/leads/summary/stats - should return all 10 summary stage counts', async () => {
      const res = await request(app)
        .get('/api/leads/summary/stats')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      const stats = res.body.data;
      assert.ok('total' in stats);
      assert.ok('new' in stats);
      assert.ok('hot' in stats);
      assert.ok('warm' in stats);
      assert.ok('cold' in stats);
      assert.ok('interested' in stats);
      assert.ok('inProgress' in stats);
      assert.ok('notInterested' in stats);
      assert.ok('dueFollowUps' in stats);
      assert.ok('converted' in stats);
      assert.ok(stats.total >= 1);
    });

    test('PATCH /api/leads/:id/status - should update status and record history', async () => {
      const res = await request(app)
        .patch(`/api/leads/${createdLeadId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Hot' });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, 'Hot');

      // Verify history item recorded
      const lead = await Lead.findById(createdLeadId);
      assert.equal(lead.status, 'Hot');
      const latestHistory = lead.history[lead.history.length - 1];
      assert.ok(latestHistory.action.includes('Hot'));
    });

    test('PATCH /api/leads/:id/review - should clear isNewLead indicator on viewing', async () => {
      const res = await request(app)
        .patch(`/api/leads/${createdLeadId}/review`)
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.isNewLead, false);
      assert.ok(res.body.data.viewedAt);
    });

    test('POST /api/leads/:id/call - should record call log and schedule follow-up', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post(`/api/leads/${createdLeadId}/call`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          duration: 180, // 3 mins
          outcome: 'Connected',
          notes: 'Client confirmed interested in corner villa plot.',
          newStatus: 'Warm',
          nextFollowUpDate: tomorrow,
          nextFollowUpRemarks: 'Send layout brochure',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, 'Warm');
      assert.equal(res.body.data.callLogs.length, 1);
      assert.equal(res.body.data.callLogs[0].outcome, 'Connected');
      assert.ok(res.body.data.nextFollowUpDate);
    });

    test('GET /api/leads/export/csv - should stream CSV formatted file', async () => {
      const res = await request(app)
        .get('/api/leads/export/csv')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.text.includes('Sarah Connor'));
      assert.ok(res.text.includes('Meta Lead Ads'));
    });

    test('GET /api/meta/connection - should return sanitized connection without secrets and with separated config', async () => {
      const res = await request(app)
        .get('/api/meta/connection')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.encryptedUserAccessToken, undefined);
      assert.ok(res.body.data.config);
      assert.ok(res.body.data.config.webhookUrl);
      assert.ok(res.body.data.config.redirectUri);
      assert.notEqual(res.body.data.config.webhookUrl, res.body.data.config.redirectUri);
    });

    test('Meta URLs separation - getWebhookUrl and getRedirectUri should be distinct', () => {
      const whUrl = getWebhookUrl();
      const rdUri = getRedirectUri();
      assert.ok(whUrl.includes('/api/meta/webhook'));
      assert.ok(rdUri.includes('callback'));
      assert.notEqual(whUrl, rdUri, 'Webhook URL and OAuth Redirect URI must not be identical');
    });

    test('GET /api/meta/config - should return separated webhookUrl and redirectUri', async () => {
      const res = await request(app)
        .get('/api/meta/config')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.webhookUrl);
      assert.ok(res.body.data.redirectUri);
      assert.notEqual(res.body.data.webhookUrl, res.body.data.redirectUri);
    });

    test('GET /api/meta/connect/url - should return authUrl with separated redirectUri and include webhookUrl', async () => {
      const res = await request(app)
        .get('/api/meta/connect/url')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.authUrl);
      assert.ok(res.body.redirectUri);
      assert.ok(res.body.webhookUrl);
      assert.notEqual(res.body.webhookUrl, res.body.redirectUri);
      assert.ok(res.body.authUrl.includes(encodeURIComponent(res.body.redirectUri)));
    });

    test('GET /api/meta/connect/callback - should redirect browser to frontend callback', async () => {
      const res = await request(app)
        .get('/api/meta/connect/callback')
        .query({ code: 'test_code_123', state: 'test_state_456' });

      assert.equal(res.status, 302);
      assert.ok(res.headers.location.includes('/connect-meta/callback'));
      assert.ok(res.headers.location.includes('test_code_123'));
    });
  });
});
