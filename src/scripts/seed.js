require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

// Models
const Organization = require('../models/Organization');
const User = require('../models/User');
const RolePermission = require('../models/RolePermission');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const SiteVisit = require('../models/SiteVisit');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

const { ROLES } = require('../constants/roles');
const { MODULE_LIST } = require('../constants/modules');
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');
const { LEAD_STATUSES, PROPERTY_AVAILABILITY, BOOKING_STATUSES } = require('../constants/statuses');

const seedData = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('[Seed] Connecting to database...');
      await connectDB();
    } else {
      console.log('[Seed] Using existing active database connection.');
    }

    console.log('[Seed] Clearing existing collections...');
    await Promise.all([
      Organization.deleteMany({}),
      User.deleteMany({}),
      RolePermission.deleteMany({}),
      Property.deleteMany({}),
      Lead.deleteMany({}),
      Customer.deleteMany({}),
      SiteVisit.deleteMany({}),
      Booking.deleteMany({}),
      Payment.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);

    console.log('[Seed] Creating Organization...');
    const org = await Organization.create({
      name: 'Royal Crest Real Estate & Land Developers',
      legalName: 'Royal Crest Realty Pvt Ltd',
      registrationNumber: 'RERA-KA-2024-99812',
      email: 'contact@royalcrest.com',
      phone: '+91 98765 43210',
      website: 'https://royalcrestrealty.com',
      address: {
        street: '14th Floor, Prestige Trade Tower, Palace Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
      branding: {
        primaryColor: '#B88A2E',
        darkGold: '#8C671D',
        lightGold: '#F5EBD3',
      },
      timezone: 'Asia/Kolkata',
      currency: {
        code: 'INR',
        symbol: '₹',
      },
      enabledModules: MODULE_LIST,
    });

    console.log('[Seed] Creating Role Accounts (Owner, Admin, HR, Employee)...');
    const ownerEmail = (process.env.OWNER_EMAIL || 'owner@estateflow.com').toLowerCase();
    const ownerPassword = process.env.OWNER_PASSWORD || 'Password@123';

    const owner = await User.create({
      organizationId: org._id,
      firstName: process.env.OWNER_FIRST_NAME || 'Managing',
      lastName: process.env.OWNER_LAST_NAME || 'Director',
      email: ownerEmail,
      phone: process.env.OWNER_PHONE || '+91 98765 00000',
      password: ownerPassword,
      role: ROLES.OWNER,
      department: 'Executive Board',
      designation: 'Managing Director & Founder',
      employeeId: 'EMP-001',
      isEmailVerified: true,
      isActive: true,
    });

    const admin = await User.create({
      organizationId: org._id,
      firstName: 'Ananya',
      lastName: 'Deshmukh',
      email: 'admin@estateflow.com',
      phone: '+91 99001 44556',
      password: 'Password@123',
      role: ROLES.ADMIN,
      department: 'Operations',
      designation: 'Head of Operations',
      employeeId: 'EMP-002',
      isEmailVerified: true,
      isActive: true,
    });

    const hr = await User.create({
      organizationId: org._id,
      firstName: 'Rajesh',
      lastName: 'Menon',
      email: 'hr@estateflow.com',
      phone: '+91 99001 77889',
      password: 'Password@123',
      role: ROLES.HR,
      department: 'Human Resources',
      designation: 'HR Director',
      employeeId: 'EMP-003',
      isEmailVerified: true,
      isActive: true,
    });

    const employee = await User.create({
      organizationId: org._id,
      firstName: 'Rohan',
      lastName: 'Verma',
      email: 'agent@estateflow.com',
      phone: '+91 99001 99000',
      password: 'Password@123',
      role: ROLES.EMPLOYEE,
      department: 'Sales & CRM',
      designation: 'Senior Real Estate Consultant',
      employeeId: 'EMP-004',
      isEmailVerified: true,
      isActive: true,
    });

    console.log('[Seed] Setting up Role Permissions...');
    for (const [roleName, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await RolePermission.create({
        organizationId: org._id,
        role: roleName,
        allowedModules: config.modules,
        allowedPermissions: config.permissions,
        updatedBy: owner._id,
      });
    }

    console.log('[Seed] Creating Properties & Plots...');
    const prop1 = await Property.create({
      organizationId: org._id,
      propertyCode: 'EF-PLT-0001',
      title: 'Silver Oak Greens — Premium Villa Plot 101',
      propertyType: 'Residential Plot',
      listingType: 'Sale',
      unitNumber: 'Plot-101',
      projectName: 'Silver Oak Greens Phase 1',
      location: {
        locality: 'Devanahalli Airport Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        landmark: 'Near Aerospace Park',
      },
      area: { value: 2400, unit: 'sq.ft' },
      facing: 'East',
      pricing: {
        basePrice: 4800000,
        ratePerUnitArea: 2000,
        bookingTokenAmount: 100000,
      },
      description: 'North-East corner luxury residential villa plot inside gated enclave with wide 40ft blacktop roads, underground cabling, and landscaped parks.',
      amenities: ['24/7 Security', 'Clubhouse', 'Gated Community', 'Swimming Pool', 'Underground Utilities'],
      assignedTo: employee._id,
      status: PROPERTY_AVAILABILITY.AVAILABLE,
    });

    const prop2 = await Property.create({
      organizationId: org._id,
      propertyCode: 'EF-PROP-0002',
      title: 'Palm Vista Luxury 3BHK Apartment #402',
      propertyType: 'Apartment',
      listingType: 'Sale',
      unitNumber: 'Apt-402',
      projectName: 'Palm Vista Towers',
      location: {
        locality: 'Whitefield',
        city: 'Bengaluru',
        state: 'Karnataka',
        landmark: 'Adjacent to ITPL',
      },
      area: { value: 1850, unit: 'sq.ft' },
      facing: 'North',
      pricing: {
        basePrice: 11500000,
        ratePerUnitArea: 6216,
        bookingTokenAmount: 200000,
      },
      description: 'Designer 3-bedroom, 3-bathroom high-floor corner residence overlooking central boulevard. Italian marble flooring and automated lighting.',
      amenities: ['Gymnasium', 'Tennis Court', 'Covered Car Park', 'EV Charging Station', 'Infinity Pool'],
      assignedTo: employee._id,
      status: PROPERTY_AVAILABILITY.RESERVED,
    });

    const prop3 = await Property.create({
      organizationId: org._id,
      propertyCode: 'EF-PROP-0003',
      title: 'Apex Sovereign Commercial Suite 501',
      propertyType: 'Commercial',
      listingType: 'Sale',
      unitNumber: 'Suite-501',
      projectName: 'Apex Sovereign',
      location: {
        locality: 'Outer Ring Road (Bellandur)',
        city: 'Bengaluru',
        state: 'Karnataka',
        landmark: 'EcoWorld Campus',
      },
      area: { value: 3200, unit: 'sq.ft' },
      facing: 'North-East',
      pricing: {
        basePrice: 28500000,
        ratePerUnitArea: 8906,
        bookingTokenAmount: 500000,
      },
      description: 'Grade-A corporate office suite with high efficiency floor plates, 100% DG backup, and 3-tier LEED certified architectural design.',
      amenities: ['High Speed Elevators', 'Cafeteria', 'Visitor Valet', '24/7 Power Backup', 'Fire Sprinklers'],
      assignedTo: admin._id,
      status: PROPERTY_AVAILABILITY.AVAILABLE,
    });

    const prop4 = await Property.create({
      organizationId: org._id,
      propertyCode: 'EF-PLT-0004',
      title: 'Emerald Valley Plot 44',
      propertyType: 'Residential Plot',
      listingType: 'Sale',
      unitNumber: 'Plot-44',
      projectName: 'Emerald Valley',
      location: {
        locality: 'Sarjapur Main Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        landmark: 'Near Wipro SEZ',
      },
      area: { value: 1500, unit: 'sq.ft' },
      facing: 'North',
      pricing: {
        basePrice: 3750000,
        ratePerUnitArea: 2500,
        bookingTokenAmount: 50000,
      },
      description: 'Compact east-facing villa plot ready for immediate home construction with Cauvery water connection and RERA approval.',
      amenities: ['Jogging Track', 'Children Play Area', 'Solar Streetlights'],
      assignedTo: employee._id,
      status: PROPERTY_AVAILABILITY.SOLD,
    });

    console.log('[Seed] Creating Leads & CRM Records...');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const lead1 = await Lead.create({
      organizationId: org._id,
      leadCode: 'EF-LD-2026-0001',
      name: 'Dr. Siddharth Mukherjee',
      phone: '+91 98450 11223',
      email: 'siddharth.m@gmail.com',
      preferredPropertyType: 'Residential Plot',
      preferredLocation: 'Airport Road / Devanahalli',
      budgetMin: 4000000,
      budgetMax: 5500000,
      source: 'Referral',
      priority: 'High',
      status: 'Negotiation',
      assignedTo: employee._id,
      nextFollowUpDate: today, // DUE TODAY
      nextFollowUpRemarks: 'Discuss final stamp duty discount and schedule token advance payment.',
      notes: 'Cardiologist at Manipal Hospital looking for a 2400 sqft villa plot for weekend retreat.',
      history: [
        { action: 'Lead Created', performedBy: employee._id, newStatus: 'New' },
        { action: 'Site Visit Completed', performedBy: employee._id, newStatus: 'Interested' },
        { action: 'Moved to Negotiation', performedBy: employee._id, newStatus: 'Negotiation' },
      ],
    });

    const lead2 = await Lead.create({
      organizationId: org._id,
      leadCode: 'EF-LD-2026-0002',
      name: 'Pooja Kashyap',
      phone: '+91 98450 33445',
      email: 'pooja.kashyap@techcorp.com',
      preferredPropertyType: 'Apartment',
      preferredLocation: 'Whitefield',
      budgetMin: 10000000,
      budgetMax: 13000000,
      source: 'Website',
      priority: 'Urgent',
      status: 'Site Visit Scheduled',
      assignedTo: employee._id,
      nextFollowUpDate: yesterday, // OVERDUE
      nextFollowUpRemarks: 'Call back regarding loan pre-approval letter and floor plan layout confirmation.',
      notes: 'Engineering Director looking for immediate possession 3BHK.',
      history: [
        { action: 'Web Enquiry Received', performedBy: employee._id, newStatus: 'New' },
        { action: 'Contact Established', performedBy: employee._id, newStatus: 'Contacted' },
      ],
    });

    const lead3 = await Lead.create({
      organizationId: org._id,
      leadCode: 'EF-LD-2026-0003',
      name: 'Harish Babu',
      phone: '+91 98450 55667',
      email: 'harish.babu@enterprises.in',
      preferredPropertyType: 'Commercial',
      preferredLocation: 'Outer Ring Road',
      budgetMin: 25000000,
      budgetMax: 30000000,
      source: 'Channel Partner',
      priority: 'Medium',
      status: 'Contacted',
      assignedTo: employee._id,
      nextFollowUpDate: tomorrow,
      nextFollowUpRemarks: 'Send audited floor layout blueprints and expected rental yield spreadsheet.',
      notes: 'Investor interested in Grade-A commercial leasing asset.',
    });

    console.log('[Seed] Creating Customer Profiles...');
    const customer1 = await Customer.create({
      organizationId: org._id,
      customerCode: 'EF-CUST-2026-0001',
      name: 'Kavita Sundaram',
      phone: '+91 98450 77889',
      email: 'kavita.sundaram@gmail.com',
      alternativePhone: '+91 98450 88990',
      address: {
        street: '72 Richmond Circle, Ashok Nagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560025',
      },
      identityProof: {
        idType: 'PAN',
        idNumber: 'ABCPS1234F',
      },
      assignedExecutive: employee._id,
      preferences: {
        propertyType: 'Apartment',
        preferredLocation: 'Whitefield',
        budget: 12000000,
      },
      notes: 'Long-term VIP investor. Has booked Palm Vista apartment #402.',
    });

    console.log('[Seed] Creating Site Visits...');
    await SiteVisit.create({
      organizationId: org._id,
      visitCode: 'EF-VIS-2026-0001',
      leadId: lead1._id,
      visitorName: lead1.name,
      visitorPhone: lead1.phone,
      propertyId: prop1._id,
      assignedTo: employee._id,
      scheduledTime: today,
      meetingPoint: 'Silver Oak Site Office Gate 1',
      status: 'Scheduled',
      outcome: 'Pending Visit',
      feedbackNotes: 'Client confirmed chauffeur pickup from Hebbal Flyover.',
    });

    await SiteVisit.create({
      organizationId: org._id,
      visitCode: 'EF-VIS-2026-0002',
      customerId: customer1._id,
      visitorName: customer1.name,
      visitorPhone: customer1.phone,
      propertyId: prop2._id,
      assignedTo: employee._id,
      scheduledTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      meetingPoint: 'Palm Vista Experience Center',
      status: 'Completed',
      outcome: 'Ready to Book',
      feedbackNotes: 'Client was impressed with 14th floor panoramic city views and clubhouse amenities. Decided to proceed with booking.',
    });

    console.log('[Seed] Creating Deal Bookings & Financial Ledger Records...');
    const booking1 = await Booking.create({
      organizationId: org._id,
      bookingReference: 'EF-BK-2026-0001',
      customerId: customer1._id,
      propertyId: prop2._id,
      bookingDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      agreedPrice: 11500000,
      bookingAmount: 200000,
      totalPaid: 2500000,
      balanceDue: 9000000,
      paymentTerms: '20% on booking advance, 60% upon structural slab completion, 20% on handover.',
      assignedTo: employee._id,
      status: BOOKING_STATUSES.CONFIRMED,
      notes: 'Deal finalized with 1 covered stilt parking slot included in base price.',
      history: [
        { action: 'Booking Created', performedBy: employee._id, note: 'Token advance collected' },
        { action: 'Booking Confirmed', performedBy: admin._id, note: 'Executive approval confirmed' },
      ],
    });

    prop2.activeBookingId = booking1._id;
    await prop2.save();

    console.log('[Seed] Recording Ledger Payments...');
    const pay1 = await Payment.create({
      organizationId: org._id,
      paymentReference: 'EF-PAY-2026-0001',
      bookingId: booking1._id,
      customerId: customer1._id,
      amount: 200000,
      paymentDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      paymentMethod: 'UPI',
      paymentType: 'Booking Advance',
      transactionReference: 'UPI/20261021/88761234',
      status: 'Completed',
      recordedBy: employee._id,
      receiptNumber: 'REC-2026-0001',
      notes: 'Initial booking advance via HDFC UPI',
    });

    const pay2 = await Payment.create({
      organizationId: org._id,
      paymentReference: 'EF-PAY-2026-0002',
      bookingId: booking1._id,
      customerId: customer1._id,
      amount: 2300000,
      paymentDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      paymentMethod: 'Bank Transfer (NEFT/RTGS/IMPS)',
      paymentType: 'Installment',
      transactionReference: 'RTGS-HDFC-99128374',
      status: 'Completed',
      recordedBy: admin._id,
      receiptNumber: 'REC-2026-0002',
      notes: 'First milestone tranche cleared from client bank account',
    });

    console.log('[Seed] Creating In-App Notifications...');
    await Notification.create({
      organizationId: org._id,
      recipientId: employee._id,
      title: 'Follow-up Due: Dr. Siddharth Mukherjee',
      message: 'You have a scheduled follow-up due today with lead Dr. Siddharth Mukherjee.',
      type: 'follow_up_due',
      linkUrl: `/leads`,
      isRead: false,
    });

    await Notification.create({
      organizationId: org._id,
      recipientId: employee._id,
      title: 'Site Visit Reminder: Plot 101',
      message: 'Site visit for Silver Oak Greens Plot 101 is scheduled today at 2:00 PM.',
      type: 'site_visit_upcoming',
      linkUrl: `/site-visits`,
      isRead: false,
    });

    await Notification.create({
      organizationId: org._id,
      recipientId: owner._id,
      title: 'Payment Received: ₹23,00,000',
      message: 'Milestone payment for Booking EF-BK-2026-0001 has been confirmed by Accounts.',
      type: 'payment_received',
      linkUrl: `/payments`,
      isRead: false,
    });

    console.log('\n======================================================');
    console.log(' ESTATEFLOW SEED COMPLETED SUCCESSFULLY!');
    console.log(' Organization: Royal Crest Real Estate & Land Developers');
    console.log(' Demo Accounts Ready for Testing:');
    console.log('   Owner:    owner@estateflow.com   / Password@123');
    console.log('   Admin:    admin@estateflow.com   / Password@123');
    console.log('   HR:       hr@estateflow.com      / Password@123');
    console.log('   Employee: agent@estateflow.com   / Password@123');
    console.log('======================================================\n');

    return true;
  } catch (err) {
    console.error('[Seed] Error during database seeding:', err);
    throw err;
  }
};

const autoBootstrapIfEmpty = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('[AutoBootstrap] No users found in database. Automatically initializing demo data & credentials...');
      await seedData();
      console.log('[AutoBootstrap] Initialization completed. Ready for login.');
    } else {
      console.log(`[AutoBootstrap] Database already initialized (${userCount} users present).`);
    }
  } catch (err) {
    console.error('[AutoBootstrap] Error verifying/bootstrapping database:', err.message);
  }
};

if (require.main === module) {
  seedData()
    .then(() => disconnectDB())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = {
  seedData,
  autoBootstrapIfEmpty,
};
