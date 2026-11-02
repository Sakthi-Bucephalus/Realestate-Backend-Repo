const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Organization = require('../src/models/Organization');
const Lead = require('../src/models/Lead');
const RolePermission = require('../src/models/RolePermission');
const { ROLES } = require('../src/constants/roles');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/constants/permissions');
const { ACCOUNT_STATUSES } = require('../src/constants/statuses');

describe('LevoraLead - RBAC, 7 Roles Hierarchy & MD Protection Tests', () => {
  let mdToken;
  let mdUser;
  let directorToken;
  let directorUser;
  let mediatorToken;
  let mediatorUser;
  let org;
  let testLead1;
  let testLead2;

  before(async () => {
    await connectDB();
    await Organization.deleteMany({});
    await User.deleteMany({});
    await RolePermission.deleteMany({});
    await Lead.deleteMany({});
  });

  after(async () => {
    await disconnectDB();
  });

  test('1. Initial MD Registration Flow with Email OTP', async () => {
    // Check setup before registration
    const checkRes = await request(app).get('/api/auth/check-setup');
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.setupRequired, true);
    assert.equal(checkRes.body.mdExists, false);

    // Register initial MD
    const regRes = await request(app)
      .post('/api/auth/register-md')
      .send({
        organizationName: 'Levora Royal Realty',
        legalName: 'Levora Royal Realty Pvt Ltd',
        officialEmail: 'md@levoraroyal.com',
        phone: '+91 98765 11111',
        firstName: 'Vikram',
        lastName: 'Singhania',
        password: 'Password@MD123',
      });

    assert.equal(regRes.status, 200);
    assert.equal(regRes.body.success, true);
    assert.match(regRes.body.message, /verification code has been dispatched/i);

    // Verify unverified MD cannot log in before verifying OTP
    const unverifiedLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'md@levoraroyal.com',
        password: 'Password@MD123',
      });

    assert.equal(unverifiedLogin.status, 403);
    assert.match(unverifiedLogin.body.message, /pending email verification/i);

    // Fetch the pending MD user directly from DB to obtain provisional record
    const pendingMD = await User.findOne({ email: 'md@levoraroyal.com' }).select('+otpHash');
    assert.ok(pendingMD, 'Pending MD record must exist in DB');
    assert.equal(pendingMD.isEmailVerified, false);
    assert.equal(pendingMD.accountStatus, ACCOUNT_STATUSES.PENDING_VERIFICATION);

    // Verify with invalid OTP returns 400
    const failVerify = await request(app)
      .post('/api/auth/verify-md-otp')
      .send({
        email: 'md@levoraroyal.com',
        otp: '000000',
      });

    assert.equal(failVerify.status, 400);
    assert.equal(failVerify.body.success, false);

    // Test bypass with compareOtp helper or by setting known hash
    const bcrypt = require('bcryptjs');
    const knownOtp = '789123';
    pendingMD.otpHash = await bcrypt.hash(knownOtp, 10);
    pendingMD.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pendingMD.save();

    // Verify with valid OTP
    const successVerify = await request(app)
      .post('/api/auth/verify-md-otp')
      .send({
        email: 'md@levoraroyal.com',
        otp: knownOtp,
      });

    assert.equal(successVerify.status, 200);
    assert.equal(successVerify.body.success, true);
    assert.ok(successVerify.body.token, 'Token returned on successful MD OTP verification');
    assert.equal(successVerify.body.user.role, ROLES.MANAGING_DIRECTOR);

    mdToken = successVerify.body.token;
    mdUser = successVerify.body.user;
    org = await Organization.findById(mdUser.organizationId);
    assert.ok(org.isActive, 'Organization must be activated after MD verification');
  });

  test('2. Prevention of Duplicate Initial MD Registration', async () => {
    // Now that MD is active, check-setup must report setupRequired: false
    const checkRes = await request(app).get('/api/auth/check-setup');
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.setupRequired, false);
    assert.equal(checkRes.body.mdExists, true);

    // Attempting a second MD registration must be rejected with 403 Forbidden
    const dupRes = await request(app)
      .post('/api/auth/register-md')
      .send({
        organizationName: 'Intruder Corp',
        officialEmail: 'intruder@other.com',
        firstName: 'Intruder',
        password: 'Password@123',
      });

    assert.equal(dupRes.status, 403);
    assert.equal(dupRes.body.success, false);
    assert.match(dupRes.body.message, /registration is closed/i);
  });

  test('3. MD Has Unrestricted Universal Access Across All Modules', async () => {
    // MD profile contains all modules and all permissions
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${mdToken}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.role, ROLES.MANAGING_DIRECTOR);
    assert.ok(meRes.body.user.allowedModules.includes('leads'));
    assert.ok(meRes.body.user.allowedModules.includes('settings'));
    assert.ok(meRes.body.user.allowedModules.includes('employees'));

    // Even if organization-wide modules disable a module, MD must retain access
    await Organization.findByIdAndUpdate(org._id, {
      $set: { enabledModules: ['dashboard', 'settings'] }, // Disabled leads
    });

    const leadRes = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${mdToken}`);

    assert.equal(leadRes.status, 200, 'MD must never be blocked by disabled organization modules');

    // Restore full modules
    await Organization.findByIdAndUpdate(org._id, {
      $set: { enabledModules: Object.values(require('../src/constants/modules').MODULES) },
    });
  });

  test('4. MD Can Create Users for All 7 Organizational Roles', async () => {
    // 1. Director
    const dirRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Diana',
        lastName: 'Director',
        email: 'diana@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.DIRECTOR,
        department: 'Executive',
        zone: 'North Zone',
        team: 'Executive Board',
        delegatedPermissions: {
          canManageRoles: [ROLES.BUSINESS_MANAGER, ROLES.SALES_MANAGER, ROLES.MEDIATOR],
          canApproveBookings: true,
        },
      });

    assert.equal(dirRes.status, 201);
    assert.equal(dirRes.body.data.role, ROLES.DIRECTOR);
    directorUser = dirRes.body.data;

    // 2. Business Manager
    const bmRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Bob',
        lastName: 'Manager',
        email: 'bob.bm@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.BUSINESS_MANAGER,
        zone: 'North Zone',
      });
    assert.equal(bmRes.status, 201);

    // 3. Zonal Manager
    const zmRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Zack',
        lastName: 'Zonal',
        email: 'zack.zm@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.ZONAL_MANAGER,
        zone: 'North Zone',
      });
    assert.equal(zmRes.status, 201);

    // 4. Sales Manager
    const smRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Sarah',
        lastName: 'Sales',
        email: 'sarah.sm@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.SALES_MANAGER,
        team: 'Alpha Team',
      });
    assert.equal(smRes.status, 201);

    // 5. Mediator
    const medRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Mike',
        lastName: 'Mediator',
        email: 'mike.med@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.MEDIATOR,
      });
    assert.equal(medRes.status, 201);
    mediatorUser = medRes.body.data;

    // 6. Referrals
    const refRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        firstName: 'Rachel',
        lastName: 'Referral',
        email: 'rachel.ref@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.REFERRALS,
      });
    assert.equal(refRes.status, 201);
  });

  test('5. Prevention of Privilege Escalation: Non-MD Cannot Create MD or Exceed Delegation', async () => {
    // Authenticate as Director
    const dirLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'diana@levoraroyal.com',
        password: 'Password@123',
      });

    assert.equal(dirLogin.status, 200);
    directorToken = dirLogin.body.token;

    // 1. Director attempts to create an MD account -> must be rejected with 403 Forbidden
    const escalateRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        firstName: 'Rogue',
        lastName: 'MD',
        email: 'rogue.md@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.MANAGING_DIRECTOR,
      });

    assert.equal(escalateRes.status, 403);
    assert.match(escalateRes.body.message, /only the managing director/i);

    // 2. Director attempts to create another Director -> rejected with 403
    const createDirRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        firstName: 'Second',
        lastName: 'Director',
        email: 'second.dir@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.DIRECTOR,
      });

    assert.equal(createDirRes.status, 403);
    assert.match(createDirRes.body.message, /only the managing director can appoint/i);

    // 3. Director creates a role permitted by delegation (Sales Manager) -> succeeded
    const delegatedCreate = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        firstName: 'Delegated',
        lastName: 'SalesAgent',
        email: 'delegated.agent@levoraroyal.com',
        password: 'Password@123',
        role: ROLES.SALES_MANAGER,
        team: 'Beta Team',
      });

    assert.equal(delegatedCreate.status, 201);
  });

  test('6. Protection of MD Account: Non-MD Cannot Modify, Deactivate or Suspend MD', async () => {
    // Director attempts to deactivate MD account -> rejected with 400/403
    const deactivateMD = await request(app)
      .patch(`/api/employees/${mdUser.id}/status`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        accountStatus: ACCOUNT_STATUSES.DEACTIVATED,
        reason: 'Attempted takeover',
      });

    assert.ok(deactivateMD.status === 400 || deactivateMD.status === 403);
    assert.match(deactivateMD.body.message, /managing director account cannot be deactivated/i);

    // Director attempts to edit MD account -> rejected with 403
    const editMD = await request(app)
      .put(`/api/employees/${mdUser.id}`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        firstName: 'Hacked',
      });

    assert.equal(editMD.status, 403);
    assert.match(editMD.body.message, /can only be managed by the managing director/i);
  });

  test('7. Data-Level Access Scoping: MD Has Unrestricted Visibility, Subordinates are Scoped', async () => {
    // Authenticate Mediator
    const medLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'mike.med@levoraroyal.com',
        password: 'Password@123',
      });

    assert.equal(medLogin.status, 200);
    mediatorToken = medLogin.body.token;

    // Create Lead 1 assigned to Mediator
    testLead1 = await Lead.create({
      organizationId: org._id,
      leadCode: 'EF-LD-TEST-001',
      name: 'Mediator Assigned Lead',
      phone: '+91 99999 11111',
      assignedTo: mediatorUser._id,
      status: 'New',
    });

    // Create Lead 2 assigned to someone else
    testLead2 = await Lead.create({
      organizationId: org._id,
      leadCode: 'EF-LD-TEST-002',
      name: 'Other Agent Lead',
      phone: '+91 99999 22222',
      assignedTo: directorUser._id,
      status: 'New',
    });

    // 1. Mediator queries leads -> must see ONLY Lead 1
    const medLeadsRes = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${mediatorToken}`);

    assert.equal(medLeadsRes.status, 200);
    assert.equal(medLeadsRes.body.data.length, 1);
    assert.equal(medLeadsRes.body.data[0].leadCode, 'EF-LD-TEST-001');

    // 2. MD queries leads -> must see BOTH Lead 1 and Lead 2 (unrestricted!)
    const mdLeadsRes = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${mdToken}`);

    assert.equal(mdLeadsRes.status, 200);
    assert.ok(mdLeadsRes.body.data.length >= 2);
    const codes = mdLeadsRes.body.data.map((l) => l.leadCode);
    assert.ok(codes.includes('EF-LD-TEST-001'));
    assert.ok(codes.includes('EF-LD-TEST-002'));
  });

  test('8. Account Suspension and Immediate Session Invalidation', async () => {
    // MD suspends the Mediator account
    const suspendRes = await request(app)
      .patch(`/api/employees/${mediatorUser._id}/status`)
      .set('Authorization', `Bearer ${mdToken}`)
      .send({
        accountStatus: ACCOUNT_STATUSES.SUSPENDED,
        reason: 'Under administrative review',
      });

    assert.equal(suspendRes.status, 200);
    assert.equal(suspendRes.body.data.accountStatus, ACCOUNT_STATUSES.SUSPENDED);

    // The Mediator's existing active token must now be rejected immediately
    const blockedReq = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${mediatorToken}`);

    assert.equal(blockedReq.status, 403);
    assert.match(blockedReq.body.message, /suspended/i);

    // Mediator login attempt must also be rejected
    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'mike.med@levoraroyal.com',
        password: 'Password@123',
      });

    assert.equal(blockedLogin.status, 403);
    assert.match(blockedLogin.body.message, /suspended/i);
  });
});
