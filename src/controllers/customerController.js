const Customer = require('../models/Customer');
const Booking = require('../models/Booking');
const SiteVisit = require('../models/SiteVisit');
const Payment = require('../models/Payment');
const Lead = require('../models/Lead');
const { logAudit } = require('../services/auditService');

// Helper to generate customer code
const generateCustomerCode = async (organizationId) => {
  const count = await Customer.countDocuments({ organizationId });
  const year = new Date().getFullYear();
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-CUST-${year}-${sequence}`;
};

// 1. Get all customers
const getCustomers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { customerCode: regex },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .populate('assignedExecutive', 'firstName lastName email department')
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Customer.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: customers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. Get customer by ID (With full 360 profile: bookings, site visits, payments)
const getCustomerById = async (req, res, next) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    })
      .populate('assignedExecutive', 'firstName lastName email department phone')
      .populate('originLeadId')
      .lean();

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Fetch linked records
    const [bookings, siteVisits, payments] = await Promise.all([
      Booking.find({ customerId: customer._id }).populate('propertyId').lean(),
      SiteVisit.find({ customerId: customer._id }).populate('propertyId').lean(),
      Payment.find({ customerId: customer._id }).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        ...customer,
        bookings,
        siteVisits,
        payments,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 3. Create Customer
const createCustomer = async (req, res, next) => {
  try {
    const {
      name,
      phone,
      alternativePhone,
      email,
      address,
      identityProof,
      assignedExecutive,
      preferences,
      notes,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Customer name and primary phone are required.' });
    }

    // Check duplicate
    const existing = await Customer.findOne({
      organizationId: req.organizationId,
      phone: phone.trim(),
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Customer already exists with this phone number (${existing.customerCode} - ${existing.name})`,
      });
    }

    const customerCode = await generateCustomerCode(req.organizationId);

    const customer = await Customer.create({
      organizationId: req.organizationId,
      customerCode,
      name: name.trim(),
      phone: phone.trim(),
      alternativePhone: alternativePhone || '',
      email: email ? email.trim().toLowerCase() : '',
      address: address || {},
      identityProof: identityProof || { idType: 'PAN', idNumber: '' },
      assignedExecutive: assignedExecutive || req.user._id,
      preferences: preferences || {},
      notes: notes || '',
    });

    await logAudit({
      organizationId: req.organizationId,
      action: 'CUSTOMER_CREATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Customer',
      entityId: customer._id,
      details: { customerCode: customer.customerCode, name: customer.name },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Customer profile created successfully',
      data: customer,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Update Customer
const updateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const {
      name,
      phone,
      alternativePhone,
      email,
      address,
      identityProof,
      assignedExecutive,
      preferences,
      notes,
      isActive,
    } = req.body;

    if (name) customer.name = name.trim();
    if (phone) customer.phone = phone.trim();
    if (alternativePhone !== undefined) customer.alternativePhone = alternativePhone;
    if (email !== undefined) customer.email = email.trim().toLowerCase();
    if (address) customer.address = { ...customer.address, ...address };
    if (identityProof) customer.identityProof = { ...customer.identityProof, ...identityProof };
    if (assignedExecutive) customer.assignedExecutive = assignedExecutive;
    if (preferences) customer.preferences = { ...customer.preferences, ...preferences };
    if (notes !== undefined) customer.notes = notes;
    if (isActive !== undefined) customer.isActive = isActive;

    await customer.save();

    await logAudit({
      organizationId: req.organizationId,
      action: 'CUSTOMER_UPDATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Customer',
      entityId: customer._id,
      details: { updates: req.body },
      req,
    });

    return res.json({
      success: true,
      message: 'Customer details updated successfully',
      data: customer,
    });
  } catch (err) {
    next(err);
  }
};

// 5. Delete Customer
const deleteCustomer = async (req, res, next) => {
  try {
    const bookingCount = await Booking.countDocuments({ customerId: req.params.id });
    if (bookingCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete customer: There are ${bookingCount} bookings associated with this customer. Deactivate account instead.`,
      });
    }

    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    return res.json({ success: true, message: 'Customer removed successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
