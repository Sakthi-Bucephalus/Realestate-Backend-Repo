const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { ROLES } = require('../constants/roles');
const { LEAD_STATUSES, AUDIT_ACTIONS } = require('../constants/statuses');
const { logAudit } = require('../services/auditService');

// Helper to generate unique lead code
const generateLeadCode = async (organizationId) => {
  const count = await Lead.countDocuments({ organizationId });
  const year = new Date().getFullYear();
  const sequence = String(count + 1).padStart(4, '0');
  return `EF-LD-${year}-${sequence}`;
};

// 1. Get all leads (Paginated, Filtered, Searched)
const getLeads = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      priority = '',
      source = '',
      assignedTo = '',
      overdue = '',
      startDate = '',
      endDate = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = { organizationId: req.organizationId };

    // Record-level permission scoping: Employee role sees only assigned leads
    if (req.user.role === ROLES.EMPLOYEE) {
      query.assignedTo = req.user._id;
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (status) {
      query.status = status;
    }

    if (priority) {
      query.priority = priority;
    }

    if (source) {
      query.source = source;
    }

    // Overdue filter
    if (overdue === 'true') {
      query.nextFollowUpDate = { $lt: new Date() };
      query.status = { $nin: [LEAD_STATUSES.CONVERTED, LEAD_STATUSES.LOST] };
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { leadCode: searchRegex },
        { preferredLocation: searchRegex },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate('assignedTo', 'firstName lastName email department avatar')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Lead.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: leads,
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

// 2. Get leads grouped by Kanban stages
const getKanbanLeads = async (req, res, next) => {
  try {
    const query = { organizationId: req.organizationId };

    if (req.user.role === ROLES.EMPLOYEE) {
      query.assignedTo = req.user._id;
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'firstName lastName email avatar')
      .sort({ updatedAt: -1 })
      .lean();

    const stages = Object.values(LEAD_STATUSES);
    const board = {};

    stages.forEach((stage) => {
      board[stage] = [];
    });

    leads.forEach((lead) => {
      if (board[lead.status]) {
        board[lead.status].push(lead);
      }
    });

    return res.json({
      success: true,
      data: board,
    });
  } catch (err) {
    next(err);
  }
};

// 3. Get single lead by ID
const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    })
      .populate('assignedTo', 'firstName lastName email department phone avatar')
      .populate('history.performedBy', 'firstName lastName email')
      .populate('followUps.assignedTo', 'firstName lastName')
      .populate('convertedCustomerId')
      .lean();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === ROLES.EMPLOYEE && String(lead.assignedTo?._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are not authorized to view this lead.' });
    }

    return res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
};

// 4. Create new lead
const createLead = async (req, res, next) => {
  try {
    const {
      name,
      phone,
      email,
      preferredPropertyType,
      preferredLocation,
      budgetMin,
      budgetMax,
      source,
      priority,
      assignedTo,
      nextFollowUpDate,
      nextFollowUpRemarks,
      notes,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Lead name and phone number are required.' });
    }

    // Check potential duplicate phone
    const existingDuplicate = await Lead.findOne({
      organizationId: req.organizationId,
      phone: phone.trim(),
    });

    const leadCode = await generateLeadCode(req.organizationId);

    const lead = await Lead.create({
      organizationId: req.organizationId,
      leadCode,
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : '',
      preferredPropertyType,
      preferredLocation: preferredLocation || '',
      budgetMin: budgetMin || 0,
      budgetMax: budgetMax || 0,
      source: source || 'Website',
      priority: priority || 'Medium',
      assignedTo: assignedTo || (req.user.role === ROLES.EMPLOYEE ? req.user._id : null),
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      nextFollowUpRemarks: nextFollowUpRemarks || '',
      notes: notes || '',
      history: [
        {
          action: 'Lead Created',
          note: 'Initial enquiry logged',
          performedBy: req.user._id,
          newStatus: 'New',
        },
      ],
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.LEAD_CREATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Lead',
      entityId: lead._id,
      details: { leadCode: lead.leadCode, name: lead.name, phone: lead.phone },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: lead,
      duplicateWarning: existingDuplicate
        ? `Warning: Another lead (${existingDuplicate.leadCode} - ${existingDuplicate.name}) exists with the same phone number.`
        : null,
    });
  } catch (err) {
    next(err);
  }
};

// 5. Update lead details
const updateLead = async (req, res, next) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === ROLES.EMPLOYEE && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this lead.' });
    }

    const {
      name,
      phone,
      email,
      preferredPropertyType,
      preferredLocation,
      budgetMin,
      budgetMax,
      source,
      priority,
      status,
      assignedTo,
      nextFollowUpDate,
      nextFollowUpRemarks,
      notes,
      lostReason,
      lostNotes,
    } = req.body;

    const historyItems = [];

    // Track status change
    if (status && status !== lead.status) {
      historyItems.push({
        action: `Status Changed to ${status}`,
        previousStatus: lead.status,
        newStatus: status,
        performedBy: req.user._id,
      });
      lead.status = status;
    }

    // Track reassignment
    if (assignedTo && String(assignedTo) !== String(lead.assignedTo)) {
      const newUser = await User.findById(assignedTo).lean();
      historyItems.push({
        action: `Reassigned to ${newUser ? `${newUser.firstName} ${newUser.lastName}` : 'New Agent'}`,
        performedBy: req.user._id,
      });
      lead.assignedTo = assignedTo;
    }

    if (name) lead.name = name.trim();
    if (phone) lead.phone = phone.trim();
    if (email !== undefined) lead.email = email.trim().toLowerCase();
    if (preferredPropertyType) lead.preferredPropertyType = preferredPropertyType;
    if (preferredLocation !== undefined) lead.preferredLocation = preferredLocation;
    if (budgetMin !== undefined) lead.budgetMin = budgetMin;
    if (budgetMax !== undefined) lead.budgetMax = budgetMax;
    if (source) lead.source = source;
    if (priority) lead.priority = priority;
    if (notes !== undefined) lead.notes = notes;
    if (lostReason) lead.lostReason = lostReason;
    if (lostNotes) lead.lostNotes = lostNotes;

    if (nextFollowUpDate !== undefined) {
      lead.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    }
    if (nextFollowUpRemarks !== undefined) lead.nextFollowUpRemarks = nextFollowUpRemarks;

    if (historyItems.length > 0) {
      lead.history.push(...historyItems);
    }

    lead.lastContactDate = new Date();
    await lead.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.LEAD_UPDATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Lead',
      entityId: lead._id,
      details: { updates: req.body },
      req,
    });

    return res.json({
      success: true,
      message: 'Lead updated successfully',
      data: lead,
    });
  } catch (err) {
    next(err);
  }
};

// 6. Add follow-up task
const addFollowUp = async (req, res, next) => {
  try {
    const { scheduledAt, remarks, assignedTo } = req.body;
    if (!scheduledAt) {
      return res.status(400).json({ success: false, message: 'Follow-up scheduled date is required' });
    }

    const lead = await Lead.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const followUp = {
      scheduledAt: new Date(scheduledAt),
      remarks: remarks || '',
      assignedTo: assignedTo || lead.assignedTo || req.user._id,
      status: 'Pending',
    };

    lead.followUps.push(followUp);
    lead.nextFollowUpDate = new Date(scheduledAt);
    lead.nextFollowUpRemarks = remarks || '';
    lead.history.push({
      action: 'Follow-up Scheduled',
      note: `Scheduled for ${new Date(scheduledAt).toLocaleString()} - ${remarks || ''}`,
      performedBy: req.user._id,
    });

    await lead.save();

    return res.json({
      success: true,
      message: 'Follow-up task added successfully',
      data: lead,
    });
  } catch (err) {
    next(err);
  }
};

// 7. Complete a follow-up
const completeFollowUp = async (req, res, next) => {
  try {
    const { followUpId, outcome, nextFollowUpDate, nextFollowUpRemarks, status } = req.body;

    const lead = await Lead.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const followUpItem = lead.followUps.id(followUpId);
    if (followUpItem) {
      followUpItem.status = 'Completed';
      followUpItem.outcome = outcome || 'Completed';
      followUpItem.completedAt = new Date();
    }

    if (status) {
      lead.status = status;
    }

    if (nextFollowUpDate) {
      lead.nextFollowUpDate = new Date(nextFollowUpDate);
      lead.nextFollowUpRemarks = nextFollowUpRemarks || '';
    } else {
      lead.nextFollowUpDate = null;
      lead.nextFollowUpRemarks = '';
    }

    lead.history.push({
      action: 'Follow-up Completed',
      note: `Outcome: ${outcome || 'Done'}`,
      performedBy: req.user._id,
      newStatus: status || lead.status,
    });

    lead.lastContactDate = new Date();
    await lead.save();

    return res.json({
      success: true,
      message: 'Follow-up completed and outcome logged',
      data: lead,
    });
  } catch (err) {
    next(err);
  }
};

// 8. Convert Lead to Customer
const convertLeadToCustomer = async (req, res, next) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (lead.status === LEAD_STATUSES.CONVERTED && lead.convertedCustomerId) {
      return res.status(400).json({ success: false, message: 'Lead is already converted into a customer.' });
    }

    // Check if customer with phone already exists
    let customer = await Customer.findOne({
      organizationId: req.organizationId,
      phone: lead.phone,
    });

    if (!customer) {
      const customerCount = await Customer.countDocuments({ organizationId: req.organizationId });
      const customerCode = `EF-CUST-${new Date().getFullYear()}-${String(customerCount + 1).padStart(4, '0')}`;

      customer = await Customer.create({
        organizationId: req.organizationId,
        customerCode,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        originLeadId: lead._id,
        assignedExecutive: lead.assignedTo || req.user._id,
        preferences: {
          propertyType: lead.preferredPropertyType,
          preferredLocation: lead.preferredLocation,
          budget: lead.budgetMax || lead.budgetMin || 0,
        },
        notes: `Converted from lead ${lead.leadCode}. ${lead.notes}`,
      });
    }

    lead.status = LEAD_STATUSES.CONVERTED;
    lead.convertedCustomerId = customer._id;
    lead.history.push({
      action: 'Converted to Customer',
      note: `Customer profile created: ${customer.customerCode}`,
      performedBy: req.user._id,
      newStatus: LEAD_STATUSES.CONVERTED,
    });

    await lead.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.LEAD_CONVERTED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Lead',
      entityId: lead._id,
      details: { customerId: customer._id, customerCode: customer.customerCode },
      req,
    });

    return res.json({
      success: true,
      message: `Lead successfully converted! Customer profile: ${customer.customerCode}`,
      data: {
        lead,
        customer,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 9. Delete Lead
const deleteLead = async (req, res, next) => {
  try {
    const lead = await Lead.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    await logAudit({
      organizationId: req.organizationId,
      action: 'LEAD_DELETED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Lead',
      entityId: lead._id,
      details: { leadCode: lead.leadCode, name: lead.name },
      req,
    });

    return res.json({
      success: true,
      message: 'Lead deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLeads,
  getKanbanLeads,
  getLeadById,
  createLead,
  updateLead,
  addFollowUp,
  completeFollowUp,
  convertLeadToCustomer,
  deleteLead,
};
