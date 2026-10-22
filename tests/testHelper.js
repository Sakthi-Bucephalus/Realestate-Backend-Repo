const Organization = require('../src/models/Organization');
const User = require('../src/models/User');
const RolePermission = require('../src/models/RolePermission');
const Property = require('../src/models/Property');
const Customer = require('../src/models/Customer');
const { ROLES } = require('../src/constants/roles');
const { MODULE_LIST } = require('../src/constants/modules');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/constants/permissions');

const setupTestDatabase = async () => {
  // Clear any existing test data
  await Organization.deleteMany({});
  await User.deleteMany({});
  await RolePermission.deleteMany({});
  await Property.deleteMany({});
  await Customer.deleteMany({});

  const org = await Organization.create({
    name: 'EstateFlow Test Real Estate',
    email: 'test@estateflow.com',
    enabledModules: MODULE_LIST,
  });

  const owner = await User.create({
    organizationId: org._id,
    firstName: 'Test',
    lastName: 'Owner',
    email: 'owner@estateflow.com',
    password: 'Password@123',
    role: ROLES.OWNER,
    isEmailVerified: true,
    isActive: true,
  });

  for (const [role, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await RolePermission.create({
      organizationId: org._id,
      role,
      allowedModules: config.modules,
      allowedPermissions: config.permissions,
      updatedBy: owner._id,
    });
  }

  const customer = await Customer.create({
    organizationId: org._id,
    customerCode: 'EF-CUST-TEST-0001',
    name: 'John Doe',
    phone: '+91 98765 00001',
    email: 'john@example.com',
  });

  const property = await Property.create({
    organizationId: org._id,
    propertyCode: 'EF-PLT-TEST-0001',
    title: 'Test Plot 101',
    propertyType: 'Residential Plot',
    unitNumber: 'Plot-101',
    area: { value: 1200, unit: 'sq.ft' },
    pricing: { basePrice: 2500000, bookingTokenAmount: 50000 },
    status: 'Available',
  });

  return { org, owner, customer, property };
};

module.exports = {
  setupTestDatabase,
};
