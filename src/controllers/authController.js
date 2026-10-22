const User = require('../models/User');
const Organization = require('../models/Organization');
const RolePermission = require('../models/RolePermission');
const { ROLES } = require('../constants/roles');
const { MODULE_LIST } = require('../constants/modules');
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');
const { signToken } = require('../utils/token');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { AUDIT_ACTIONS } = require('../constants/statuses');

// Check if first-time bootstrap setup is needed
const checkSetup = async (req, res, next) => {
  try {
    const orgCount = await Organization.countDocuments();
    const ownerCount = await User.countDocuments({ role: ROLES.OWNER });

    const isSetupRequired = orgCount === 0 || ownerCount === 0;

    return res.json({
      success: true,
      setupRequired: isSetupRequired,
    });
  } catch (err) {
    next(err);
  }
};

// Bootstrap initial Organization and Owner account
const bootstrapOwner = async (req, res, next) => {
  try {
    const existingOwner = await User.findOne({ role: ROLES.OWNER });
    if (existingOwner) {
      return res.status(400).json({
        success: false,
        message: 'System has already been bootstrapped. Owner already exists.',
      });
    }

    const { organizationName, legalName, officialEmail, phone, firstName, lastName, password } = req.body;

    if (!organizationName || !officialEmail || !firstName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Organization name, official email, first name, and password are required.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long.',
      });
    }

    // Create organization
    const org = await Organization.create({
      name: organizationName,
      legalName: legalName || organizationName,
      email: officialEmail.toLowerCase(),
      phone: phone || '',
      enabledModules: MODULE_LIST,
    });

    // Create initial Owner user
    const owner = await User.create({
      organizationId: org._id,
      firstName,
      lastName: lastName || '',
      email: officialEmail.toLowerCase(),
      phone: phone || '',
      password,
      role: ROLES.OWNER,
      isEmailVerified: true,
      isActive: true,
      department: 'Management',
      designation: 'Managing Director / Owner',
      employeeId: 'OWNER-001',
    });

    // Initialize default permissions for all roles in this organization
    for (const [role, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await RolePermission.create({
        organizationId: org._id,
        role,
        allowedModules: config.modules,
        allowedPermissions: config.permissions,
        updatedBy: owner._id,
      });
    }

    const token = signToken({
      userId: owner._id,
      organizationId: org._id,
      role: owner.role,
      tokenVersion: owner.tokenVersion,
    });

    await logAudit({
      organizationId: org._id,
      action: AUDIT_ACTIONS.USER_CREATED,
      performedBy: owner._id,
      performedByName: `${owner.firstName} ${owner.lastName}`,
      entityType: 'User',
      entityId: owner._id,
      details: { role: ROLES.OWNER, message: 'First-time Owner Bootstrap Completed' },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Owner and Organization successfully initialized!',
      token,
      user: {
        id: owner._id,
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
        role: owner.role,
        department: owner.department,
        designation: owner.designation,
        organizationId: org._id,
        organizationName: org.name,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Send / Resend OTP to user email
const requestOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Return generic success to prevent email enumeration
      return res.json({
        success: true,
        message: 'If this email is registered, a verification code has been dispatched.',
      });
    }

    // Cooldown check (60 seconds)
    if (user.lastOtpResentAt && Date.now() - new Date(user.lastOtpResentAt).getTime() < 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: 'Please wait at least 60 seconds before requesting another code.',
      });
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    user.otpHash = otpHash;
    user.otpExpiresAt = expiresAt;
    user.otpAttempts = 0;
    user.lastOtpResentAt = new Date();
    await user.save();

    // Get organization for custom SMTP
    const org = await Organization.findById(user.organizationId).lean();
    await sendOtpEmail({
      to: user.email,
      otp,
      userName: user.firstName,
      smtpConfig: org?.smtpConfig,
    });

    return res.json({
      success: true,
      message: 'Verification code sent to registered email address.',
    });
  } catch (err) {
    next(err);
  }
};

// Verify OTP
const verifyOtpHandler = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP code are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+otpHash');
    if (!user || !user.otpHash || !user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP code.' });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'OTP code has expired. Please request a new one.' });
    }

    if (user.otpAttempts >= 5) {
      return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new code.' });
    }

    const isValid = await verifyOtp(otp, user.otpHash);
    if (!isValid) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ success: false, message: 'Incorrect OTP code.' });
    }

    // OTP verified
    user.isEmailVerified = true;
    user.otpHash = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    await user.save();

    return res.json({
      success: true,
      message: 'Email successfully verified!',
    });
  } catch (err) {
    next(err);
  }
};

// Login user
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await logAudit({
        organizationId: user.organizationId,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'User',
        entityId: user._id,
        details: { email: user.email, reason: 'Incorrect password' },
        req,
      });

      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact your organization administrator.',
        reason: user.statusChangeReason || 'Account inactive',
      });
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    const org = await Organization.findById(user.organizationId).lean();

    const token = signToken({
      userId: user._id,
      organizationId: user.organizationId,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    await logAudit({
      organizationId: user.organizationId,
      action: AUDIT_ACTIONS.LOGIN,
      performedBy: user._id,
      performedByName: `${user.firstName} ${user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      req,
    });

    // Fetch role permissions
    const rolePerm = await RolePermission.findOne({
      organizationId: user.organizationId,
      role: user.role,
    }).lean();

    const allowedModules = user.role === ROLES.OWNER
      ? (org?.enabledModules || MODULE_LIST)
      : (rolePerm?.allowedModules || []);

    const allowedPermissions = user.role === ROLES.OWNER
      ? DEFAULT_ROLE_PERMISSIONS[ROLES.OWNER].permissions
      : (rolePerm?.allowedPermissions || []);

    return res.json({
      success: true,
      message: 'Sign in successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
        employeeId: user.employeeId,
        avatar: user.avatar,
        organizationId: user.organizationId,
        organizationName: org?.name || 'EstateFlow Real Estate',
        currency: org?.currency || { code: 'INR', symbol: '₹' },
        timezone: org?.timezone || 'Asia/Kolkata',
        enabledModules: org?.enabledModules || MODULE_LIST,
        allowedModules,
        allowedPermissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get current authenticated user profile
const getMe = async (req, res, next) => {
  try {
    const user = req.user;
    const org = await Organization.findById(req.organizationId).lean();
    const rolePerm = await RolePermission.findOne({
      organizationId: user.organizationId,
      role: user.role,
    }).lean();

    const allowedModules = user.role === ROLES.OWNER
      ? (org?.enabledModules || MODULE_LIST)
      : (rolePerm?.allowedModules || []);

    const allowedPermissions = user.role === ROLES.OWNER
      ? DEFAULT_ROLE_PERMISSIONS[ROLES.OWNER].permissions
      : (rolePerm?.allowedPermissions || []);

    return res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        phone: user.phone,
        role: user.role,
        department: user.department,
        designation: user.designation,
        employeeId: user.employeeId,
        avatar: user.avatar,
        organizationId: user.organizationId,
        organizationName: org?.name || 'EstateFlow Real Estate',
        branding: org?.branding,
        currency: org?.currency || { code: 'INR', symbol: '₹' },
        timezone: org?.timezone || 'Asia/Kolkata',
        enabledModules: org?.enabledModules || MODULE_LIST,
        allowedModules,
        allowedPermissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Reset Password with OTP verification
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, OTP code, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +otpHash');
    if (!user || !user.otpHash || !user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP code' });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'OTP code has expired. Please request a new one.' });
    }

    const isValid = await verifyOtp(otp, user.otpHash);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP code.' });
    }

    user.password = newPassword;
    user.otpHash = null;
    user.otpExpiresAt = null;
    user.tokenVersion += 1; // Invalidate previous sessions
    await user.save();

    await logAudit({
      organizationId: user.organizationId,
      action: AUDIT_ACTIONS.PASSWORD_RESET,
      performedBy: user._id,
      performedByName: `${user.firstName} ${user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      req,
    });

    return res.json({
      success: true,
      message: 'Password successfully updated. You may now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};

// Trigger demo data seeding on demand
const seedDemoData = async (req, res, next) => {
  try {
    const { seedData } = require('../scripts/seed');
    await seedData();
    return res.json({
      success: true,
      message: 'Database successfully seeded with demo accounts & data!',
    });
  } catch (err) {
    next(err);
  }
};

// Change Password for authenticated user (e.g. Owner or employee)
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required.',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.',
      });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'The current password you entered is incorrect.',
      });
    }

    user.password = newPassword;
    user.tokenVersion += 1;
    await user.save();

    await logAudit({
      organizationId: user.organizationId,
      action: AUDIT_ACTIONS.PASSWORD_RESET,
      performedBy: user._id,
      performedByName: `${user.firstName} ${user.lastName}`,
      entityType: 'User',
      entityId: user._id,
      details: { message: 'Password updated via account settings' },
      req,
    });

    return res.json({
      success: true,
      message: 'Password successfully updated! Your new credentials are active.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  checkSetup,
  bootstrapOwner,
  requestOtp,
  verifyOtpHandler,
  login,
  getMe,
  resetPassword,
  changePassword,
  seedDemoData,
};
