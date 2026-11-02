const User = require('../models/User');
const Lead = require('../models/Lead');
const SiteVisit = require('../models/SiteVisit');
const { ROLES, ROLE_LIST, isManagingDirectorRole } = require('../constants/roles');
const { ACCOUNT_STATUSES, AUDIT_ACTIONS } = require('../constants/statuses');
const { logAudit } = require('../services/auditService');

/**
 * 1. Get all employees / users in organization
 * Supports pagination, searching, and filtering by role, department, zone, team, accountStatus
 */
const getEmployees = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      role = '',
      department = '',
      zone = '',
      team = '',
      accountStatus = '',
      isActive = '',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (role) query.role = role;
    if (department) query.department = department;
    if (zone) query.zone = zone;
    if (team) query.team = team;
    if (accountStatus) query.accountStatus = accountStatus;
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
        { zone: regex },
        { team: regex },
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [employees, total] = await Promise.all([
      User.find(query)
        .select('-password -otpHash')
        .populate('statusChangedBy', 'firstName lastName role')
        .populate('reportingTo', 'firstName lastName role employeeId')
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

/**
 * 2. Create new user account for any of the 7 roles
 * Enforces MD authority:
 * - Only MD can create Director, MD, or Admin accounts.
 * - Directors can only create roles explicitly permitted in their delegatedPermissions.
 * - Non-MD cannot create an MD account under any circumstances.
 */
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
      zone,
      team,
      reportingTo,
      customPermissions,
      delegatedPermissions,
    } = req.body;

    if (!firstName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, email, and password are required.',
      });
    }

    if (!ROLE_LIST.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role specified: ${role}`,
      });
    }

    const isCallerMD = isManagingDirectorRole(req.user.role);

    // Protection: Under no circumstances can a non-MD create an MD or Owner account
    if (isManagingDirectorRole(role) && !isCallerMD) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Only the Managing Director can create an MD account.',
      });
    }

    // Protection: Only MD can create Directors
    if (role === ROLES.DIRECTOR && !isCallerMD) {
      return res.status(403).json({
        success: false,
        message: 'Only the Managing Director can appoint and create Director accounts.',
      });
    }

    // Director delegation check for subordinate roles
    if (!isCallerMD && req.user.role === ROLES.DIRECTOR) {
      const allowedRoles = req.user.delegatedPermissions?.canManageRoles || [];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({
          success: false,
          message: `Your delegated Director permissions do not allow creating users with the role "${role}".`,
        });
      }
    } else if (!isCallerMD && req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.HR) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create user accounts.',
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

    // Auto-generate employee ID if omitted
    const rolePrefix = role === ROLES.DIRECTOR ? 'DIR' :
      role === ROLES.BUSINESS_MANAGER ? 'BM' :
      role === ROLES.ZONAL_MANAGER ? 'ZM' :
      role === ROLES.SALES_MANAGER ? 'SM' :
      role === ROLES.MEDIATOR ? 'MED' :
      role === ROLES.REFERRALS ? 'REF' : 'EMP';

    const autoEmpId = employeeId || `${rolePrefix}-${Math.floor(100 + Math.random() * 900)}`;

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
      zone: zone ? zone.trim() : '',
      team: team ? team.trim() : '',
      reportingTo: reportingTo || (isCallerMD ? null : req.user._id),
      accountStatus: ACCOUNT_STATUSES.ACTIVE,
      isEmailVerified: true,
      isActive: true,
      customPermissions: customPermissions || [],
      // Delegated permissions can only be configured by MD for Directors
      delegatedPermissions: isCallerMD && role === ROLES.DIRECTOR ? (delegatedPermissions || {}) : {},
    });

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.USER_CREATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      details: { role: user.role, email: user.email, zone: user.zone, team: user.team },
      req,
    });

    const userObj = user.toObject();
    delete userObj.password;

    return res.status(201).json({
      success: true,
      message: `${role} account created successfully`,
      data: userObj,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 3. Update employee profile, role, hierarchy & permissions
 * Enforces MD protection:
 * - MD account CANNOT be modified or demoted by subordinate users.
 * - Subordinate users cannot elevate themselves or others to MD.
 * - Director can only update users within their delegated scope.
 */
const updateEmployee = async (req, res, next) => {
  try {
    const targetUser = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isCallerMD = isManagingDirectorRole(req.user.role);
    const isTargetMD = isManagingDirectorRole(targetUser.role);

    // CRITICAL PROTECTION: A non-MD can NEVER modify an MD account
    if (isTargetMD && !isCallerMD) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: The Managing Director account can only be managed by the Managing Director.',
      });
    }

    // Director delegation check
    if (!isCallerMD && req.user.role === ROLES.DIRECTOR) {
      const allowedRoles = req.user.delegatedPermissions?.canManageRoles || [];
      if (!allowedRoles.includes(targetUser.role)) {
        return res.status(403).json({
          success: false,
          message: `Your delegated Director permissions do not allow modifying users with role "${targetUser.role}".`,
        });
      }
    }

    const {
      firstName,
      lastName,
      phone,
      department,
      designation,
      employeeId,
      zone,
      team,
      reportingTo,
      role,
      password,
      customPermissions,
      delegatedPermissions,
      accountStatus,
    } = req.body;

    // Role modification checks
    if (role && role !== targetUser.role) {
      // Non-MD cannot change roles to or from MD
      if ((isManagingDirectorRole(role) || isTargetMD) && !isCallerMD) {
        return res.status(403).json({
          success: false,
          message: 'Only the Managing Director can assign or reassign executive roles.',
        });
      }

      // Only MD can promote to Director
      if (role === ROLES.DIRECTOR && !isCallerMD) {
        return res.status(403).json({
          success: false,
          message: 'Only the Managing Director can appoint a user as Director.',
        });
      }

      targetUser.role = role;
      targetUser.tokenVersion += 1; // Invalidate sessions on role change
    }

    if (firstName) targetUser.firstName = firstName.trim();
    if (lastName !== undefined) targetUser.lastName = lastName.trim();
    if (phone !== undefined) targetUser.phone = phone.trim();
    if (department) targetUser.department = department;
    if (designation) targetUser.designation = designation;
    if (employeeId) targetUser.employeeId = employeeId;
    if (zone !== undefined) targetUser.zone = zone ? zone.trim() : '';
    if (team !== undefined) targetUser.team = team ? team.trim() : '';
    if (reportingTo !== undefined) targetUser.reportingTo = reportingTo || null;
    if (customPermissions) targetUser.customPermissions = customPermissions;

    // Only MD can configure delegated permissions for Directors
    if (isCallerMD && (targetUser.role === ROLES.DIRECTOR || role === ROLES.DIRECTOR) && delegatedPermissions) {
      targetUser.delegatedPermissions = {
        ...targetUser.delegatedPermissions,
        ...delegatedPermissions,
      };
      targetUser.tokenVersion += 1;
    }

    // Account status update
    if (accountStatus && Object.values(ACCOUNT_STATUSES).includes(accountStatus)) {
      if (isTargetMD && accountStatus !== ACCOUNT_STATUSES.ACTIVE) {
        return res.status(400).json({
          success: false,
          message: 'The Managing Director account must remain permanently Active.',
        });
      }
      targetUser.accountStatus = accountStatus;
      targetUser.isActive = accountStatus === ACCOUNT_STATUSES.ACTIVE;
      if (accountStatus !== ACCOUNT_STATUSES.ACTIVE) {
        targetUser.tokenVersion += 1;
      }
    }

    if (password && password.length >= 8) {
      targetUser.password = password;
      targetUser.tokenVersion += 1;
    }

    await targetUser.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: targetUser._id,
      details: { updates: req.body, targetEmail: targetUser.email, targetRole: targetUser.role },
      req,
    });

    const userObj = targetUser.toObject();
    delete userObj.password;

    return res.json({
      success: true,
      message: 'User details updated successfully',
      data: userObj,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 4. Toggle Account Lifecycle Status (Active, Suspended, Deactivated)
 * Ensures:
 * - MD account CANNOT be deactivated or suspended by anyone.
 * - Subordinate users cannot deactivate accounts above their rank.
 * - Tokens are immediately invalidated upon suspension or deactivation.
 */
const toggleAccountStatus = async (req, res, next) => {
  try {
    const { isActive, accountStatus, reason } = req.body;

    const targetUser = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isCallerMD = isManagingDirectorRole(req.user.role);
    const isTargetMD = isManagingDirectorRole(targetUser.role);

    // CRITICAL PROTECTION: The MD account cannot be deactivated or suspended
    if (isTargetMD) {
      return res.status(400).json({
        success: false,
        message: 'Security Protection: The Managing Director account cannot be deactivated or suspended.',
      });
    }

    // Prevent self-deactivation
    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Security Protection: You cannot suspend or deactivate your own account.',
      });
    }

    // Role check: Only MD or authorized Director can toggle status
    if (!isCallerMD && req.user.role === ROLES.DIRECTOR) {
      const allowedRoles = req.user.delegatedPermissions?.canManageRoles || [];
      if (!allowedRoles.includes(targetUser.role)) {
        return res.status(403).json({
          success: false,
          message: `Your delegated Director permissions do not allow modifying status for role "${targetUser.role}".`,
        });
      }
    } else if (!isCallerMD && req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.HR) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: Cannot modify user account status.',
      });
    }

    // Determine target state
    let targetActive;
    let targetAccStatus;

    if (accountStatus) {
      targetAccStatus = accountStatus;
      targetActive = accountStatus === ACCOUNT_STATUSES.ACTIVE;
    } else {
      targetActive = !!isActive;
      targetAccStatus = targetActive ? ACCOUNT_STATUSES.ACTIVE : ACCOUNT_STATUSES.DEACTIVATED;
    }

    targetUser.isActive = targetActive;
    targetUser.accountStatus = targetAccStatus;
    targetUser.statusChangeReason = reason || (targetActive ? 'Account reactivated' : `Account ${targetAccStatus}`);
    targetUser.statusChangedBy = req.user._id;
    targetUser.statusChangedAt = new Date();

    if (!targetActive) {
      // Invalidate active login sessions immediately
      targetUser.tokenVersion += 1;
    }

    await targetUser.save();

    const auditAction = targetAccStatus === ACCOUNT_STATUSES.SUSPENDED
      ? AUDIT_ACTIONS.USER_SUSPENDED
      : (targetActive ? AUDIT_ACTIONS.USER_REACTIVATED : AUDIT_ACTIONS.USER_STATUS_CHANGED);

    await logAudit({
      organizationId: req.organizationId,
      action: auditAction,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: targetUser._id,
      details: {
        isActive: targetUser.isActive,
        accountStatus: targetUser.accountStatus,
        reason: targetUser.statusChangeReason,
        targetEmail: targetUser.email,
      },
      req,
    });

    return res.json({
      success: true,
      message: `Account successfully ${targetActive ? 'reactivated' : targetAccStatus}`,
      data: targetUser,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 5. Direct Password Reset by Administrator / MD
 */
const adminResetPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.',
      });
    }

    const targetUser = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isCallerMD = isManagingDirectorRole(req.user.role);
    const isTargetMD = isManagingDirectorRole(targetUser.role);

    // MD account password can only be reset by MD
    if (isTargetMD && !isCallerMD) {
      return res.status(403).json({
        success: false,
        message: 'Only the Managing Director can reset their own password.',
      });
    }

    // Set new password and invalidate active sessions
    targetUser.password = newPassword;
    targetUser.tokenVersion += 1;
    await targetUser.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.PASSWORD_RESET,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: targetUser._id,
      details: { message: `Password reset performed by ${req.user.role}` },
      req,
    });

    return res.json({
      success: true,
      message: 'Password successfully reset. User sessions have been refreshed.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 6. Configure Director Delegated Permissions (MD Only)
 */
const delegateDirectorPermissions = async (req, res, next) => {
  try {
    const isCallerMD = isManagingDirectorRole(req.user.role);
    if (!isCallerMD) {
      return res.status(403).json({
        success: false,
        message: 'Only the Managing Director can configure Director delegated permissions.',
      });
    }

    const targetUser = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Director user not found' });
    }

    if (targetUser.role !== ROLES.DIRECTOR) {
      return res.status(400).json({
        success: false,
        message: 'Delegated permissions can only be configured for Director accounts.',
      });
    }

    const {
      canManageRoles = [],
      allowedModules = [],
      managedZones = [],
      managedTeams = [],
      canApproveBookings = false,
      canApprovePayments = false,
      canExportData = false,
    } = req.body;

    // Security guard: Ensure a Director cannot be delegated permission to manage MD
    const sanitizedRoles = canManageRoles.filter(
      (r) => !isManagingDirectorRole(r) && r !== ROLES.DIRECTOR
    );

    targetUser.delegatedPermissions = {
      canManageRoles: sanitizedRoles,
      allowedModules,
      managedZones,
      managedTeams,
      canApproveBookings: !!canApproveBookings,
      canApprovePayments: !!canApprovePayments,
      canExportData: !!canExportData,
    };

    targetUser.tokenVersion += 1; // Refresh Director session so new permissions apply
    await targetUser.save();

    await logAudit({
      organizationId: req.organizationId,
      action: AUDIT_ACTIONS.DIRECTOR_DELEGATION_CHANGED,
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'User',
      entityId: targetUser._id,
      details: { delegatedPermissions: targetUser.delegatedPermissions },
      req,
    });

    return res.json({
      success: true,
      message: 'Director delegated permissions updated successfully.',
      data: targetUser.delegatedPermissions,
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
  adminResetPassword,
  delegateDirectorPermissions,
};
