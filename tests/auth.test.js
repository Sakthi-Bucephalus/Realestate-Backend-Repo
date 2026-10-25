const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { setupTestDatabase } = require('./testHelper');

describe('EstateFlow Authentication & Session Tests', () => {
  let token;
  let testUser;
  let testOrg;

  before(async () => {
    await connectDB();
    const data = await setupTestDatabase();
    testOrg = data.org;
    testUser = data.owner;
  });

  after(async () => {
    await disconnectDB();
  });

  test('POST /api/auth/login - should authenticate with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'owner@estateflow.com',
        password: 'Password@123',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Token must be present in response');
    assert.equal(res.body.user.email, 'owner@estateflow.com');
    assert.equal(res.body.user.role, 'owner');
    token = res.body.token;
  });

  test('POST /api/auth/login - should reject invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'owner@estateflow.com',
        password: 'WrongPassword999',
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('GET /api/auth/me - should return authenticated user profile', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.email, 'owner@estateflow.com');
  });

  test('POST /api/auth/login - should deny access to deactivated account', async () => {
    const deactivated = await User.create({
      organizationId: testOrg._id,
      firstName: 'Deactivated',
      lastName: 'User',
      email: 'deactivated@estateflow.com',
      password: 'Password@123',
      role: 'employee',
      isActive: false,
      statusChangeReason: 'Terminated employment',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'deactivated@estateflow.com',
        password: 'Password@123',
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /deactivated/i);

    await User.findByIdAndDelete(deactivated._id);
  });
});
