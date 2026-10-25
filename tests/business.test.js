const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const Property = require('../src/models/Property');
const Customer = require('../src/models/Customer');
const Booking = require('../src/models/Booking');
const { setupTestDatabase } = require('./testHelper');

describe('EstateFlow Core Business Workflow Tests', () => {
  let token;
  let testCustomer;
  let availableProperty;

  before(async () => {
    await connectDB();
    const data = await setupTestDatabase();
    testCustomer = data.customer;
    availableProperty = data.property;

    // Authenticate as owner
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@estateflow.com', password: 'Password@123' });

    token = loginRes.body.token;
  });

  after(async () => {
    await disconnectDB();
  });

  test('POST /api/leads - should create lead and detect duplicates', async () => {
    const uniquePhone = `+91 99999 ${Math.floor(10000 + Math.random() * 90000)}`;
    const res1 = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Automated Test Client',
        phone: uniquePhone,
        email: 'autotest@example.com',
        budgetMin: 3000000,
        budgetMax: 4500000,
      });

    assert.equal(res1.status, 201);
    assert.equal(res1.body.success, true);
    assert.equal(res1.body.data.phone, uniquePhone);
    assert.equal(res1.body.duplicateWarning, null);

    // Second lead with same phone should trigger duplicate warning
    const res2 = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Another Lead Same Phone',
        phone: uniquePhone,
      });

    assert.equal(res2.status, 201);
    assert.ok(res2.body.duplicateWarning, 'Duplicate warning should be present');
  });

  test('POST /api/bookings - atomic property reservation & double-booking prevention', async () => {
    assert.ok(availableProperty, 'Must have at least one Available property for test');

    // Create booking for available property
    const res1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: testCustomer._id,
        propertyId: availableProperty._id,
        agreedPrice: 5000000,
        bookingAmount: 100000,
      });

    assert.equal(res1.status, 201);
    assert.equal(res1.body.success, true);
    const createdBooking = res1.body.data;
    assert.equal(createdBooking.balanceDue, 5000000);

    // Verify property status was changed to Reserved
    const updatedProp = await Property.findById(availableProperty._id);
    assert.equal(updatedProp.status, 'Reserved');

    // Attempt second booking for the same property unit must fail with 409 Conflict
    const res2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: testCustomer._id,
        propertyId: availableProperty._id,
        agreedPrice: 5200000,
        bookingAmount: 150000,
      });

    assert.equal(res2.status, 409);
    assert.equal(res2.body.success, false);
    assert.match(res2.body.message, /no longer available/i);
  });
});
