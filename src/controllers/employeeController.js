const User = require('../models/User');
const Lead = require('../models/Lead');
const SiteVisit = require('../models/SiteVisit');
const { ROLES } = require('../constants/roles');
const { AUDIT_ACTIONS } = require('../constants/statuses');
const { logAudit } = require('../services/auditService');

// 1. Get all employees
const getEmployees = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      role = '',
      department = '',
      isActive = '',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (role) query.role = role;
    if (department) query.department = department;
    if (isActive !== '') query.isActive = isActive === 'true';

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { employeeId: regex },
        { designation: regex },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [employees, total] = await Promise.all([
      User.find(query)
        .select('-password -otpHash')
        .populate('statusChangedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    // Attach quick stats per employee (leads count, visits count)
    const employeeIds = employees.map((e) => e._id);
    const [leadCounts, visitCounts] = await Promise.all([
      Lead.aggregate([
        { $match: { assignedTo: { $in: employeeIds } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      ]),
      SiteVisit.aggregate([
        { $match: { assignedTo: { $in: employeeIds } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      ]),
    ]);

    const leadCountMap = Object.fromEntries(leadCounts.map((l) => [String(l._id), l.count]));
    const visitCountMap = Object.fromEntries(visitCounts.map((v) => [String(v._id), v.count]));

    const enriched = employees.map((emp) => ({
      ...emp,
      stats: {
        assignedLeads: leadCountMap[String(emp._id)] || 0,
        assignedVisits: visitCountMap[String(emp._id)] || 0,
      },
    }));

    return res.json({
      success: true,
      data: enriched,
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

// 2. Create new employee account
const createEmployee = async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      role = ROLES.EMPLOYEE,
      department,
      designation,
      employeeId,
      customPermissions,
    } = req.body;

    if (!firstName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, email, and password are required.',
      });
    }

    // Role privilege restriction: Only Owner can create Owner or Admin accounts
    if (role === ROLES.OWNER && req.user.role !== ROLES.OWNER) {
      return res.status(403).json({
        success: false,
        message: 'Only the organization Owner can create another Owner account.',
      });
    }

    if (role === ROLES.ADMIN && req.user.role !== ROLES.OWNER) {
      return res.status(403).json({
        success: false,
        message: 'Only the organization Owner can create an Admin account.',
      });
    }

    // Check duplicate email in organization
    const existing = await User.findOne({
      organizationId: req.organizationId,
      email: email.trim().toLowerCase(),
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email address already exists in your organization.',
      });
    }

    const autoEmpId = employeeId || `EMP-${Math.floor(100 + Math.random() * 900)}`;

    const user = await User.create({
      organizationId: req.organizationId,
      firstName: firstName.trim(),
      lastName: lastName ? lastName.trim() : '',
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      password,
      role,
      department: department || 'Sales',
      designation: designation || 'Executive',
      employeeId: autoEmpId,
      isEmailVerified: true,
      isActive: true,
      customPermissions: customPermissions || [],
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.USER_CREATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      details: { role: user.role, email: user.email, department: user.department },
      req,
    });

    const userObj = user.toObject();
    delete userObj.password;

    return res.status(201).json({
      success: true,
      message: 'Employee account created successfully',
      data: userObj,
    });
  } catch (err) {
    next(err);
  }
};

// 3. Update employee profile & permissions
const updateEmployee = async (req, res, next) => {
  try {
    const user = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const {
      firstName,
      lastName,
      phone,
      department,
      designation,
      employeeId,
      role,
      password,
      customPermissions,
    } = req.body;

    // Privilege check: Only Owner can change role to/from Admin or Owner
    if (role && role !== user.role) {
      if (req.user.role !== ROLES.OWNER) {
        return res.status(403).json({
          success: false,
          message: 'Only the organization Owner can change user roles.',
        });
      }
      user.role = role;
    }

    if (firstName) user.firstName = firstName.trim();
    if (lastName !== undefined) user.lastName = lastName.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (department) user.department = department;
    if (designation) user.designation = designation;
    if (employeeId) user.employeeId = employeeId;
    if (customPermissions) user.customPermissions = customPermissions;

    if (password && password.length >= 8) {
      user.password = password;
      user.tokenVersion += 1; // Invalidate sessions
    }

    await user.save();

    await logAudit({
      organizationId: req.organizationId,
      action: 'USER_UPDATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      details: { updates: req.body },
      req,
    });

    return res.json({
      success: true,
      message: 'Employee updated successfully',
      data: user,
    });
  } catch (err) {
    next(err);
  }
};

// 4. Toggle Active / Inactive Account Lifecycle
const toggleAccountStatus = async (req, res, next) => {
  try {
    const { isActive, reason } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive status is required.' });
    }

    const targetUser = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Guard: Prevent self-deactivation
    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Security protection: You cannot deactivate your own account.',
      });
    }

    // Guard: Prevent deactivating the last active Owner account
    if (targetUser.role === ROLES.OWNER && !isActive) {
      const activeOwnerCount = await User.countDocuments({
        organizationId: req.organizationId,
        role: ROLES.OWNER,
        isActive: true,
      });

      if (activeOwnerCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate the last active Owner account of this organization.',
        });
      }
    }

    // Role check: HR and Admin cannot deactivate an Owner account
    if (targetUser.role === ROLES.OWNER && req.user.role !== ROLES.OWNER) {
      return res.status(403).json({
        success: false,
        message: 'Only an Owner can deactivate another Owner account.',
      });
    }

    targetUser.isActive = !!isActive;
    targetUser.statusChangeReason = reason || (isActive ? 'Reactivated' : 'Deactivated by administrator');
    targetUser.statusChangedBy = req.user._id;
    targetUser.statusChangedAt = new Date();

    if (!isActive) {
      // Invalidate active login sessions immediately
      targetUser.tokenVersion += 1;
    }

    await targetUser.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: targetUser._id,
      details: {
        isActive: targetUser.isActive,
        reason: targetUser.statusChangeReason,
        targetEmail: targetUser.email,
      },
      req,
    });

    return res.json({
      success: true,
      message: `Account successfully ${isActive ? 'reactivated' : 'deactivated'}`,
      data: targetUser,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getEmployees,
  createEmployee,
  updateEmployee,
  toggleAccountStatus,
};
