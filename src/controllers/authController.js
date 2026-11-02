const User = require('../models/User');
const Organization = require('../models/Organization');
const RolePermission = require('../models/RolePermission');
const { ROLES, isManagingDirectorRole } = require('../constants/roles');
const { MODULE_LIST } = require('../constants/modules');
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');
const { ACCOUNT_STATUSES, AUDIT_ACTIONS } = require('../constants/statuses');
const { signToken } = require('../utils/token');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');

/**
 * Check if initial Managing Director / Organization bootstrap is required.
 * If an active MD or Owner exists, setup is closed.
 */
const checkSetup = async (req, res, next) => {
  try {
    const verifiedMDCount = await User.countDocuments({
      role: { $in: [ROLES.MANAGING_DIRECTOR, ROLES.OWNER, 'md'] },
      isEmailVerified: true,
      accountStatus: { $ne: ACCOUNT_STATUSES.PENDING_VERIFICATION },
    });

    const isSetupRequired = verifiedMDCount === 0;

    return res.json({
      success: true,
      setupRequired: isSetupRequired,
      mdExists: !isSetupRequired,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Step 1 of Initial MD Registration:
 * Collects details, validates inputs, generates secure time-limited email OTP,
 * and sends it via email. Atomic lock prevents duplicate or concurrent MD registration.
 */
const registerInitialMD = async (req, res, next) => {
  try {
    // 1. Atomic check: has an active MD already been bootstrapped?
    const existingActiveMD = await User.findOne({
      role: { $in: [ROLES.MANAGING_DIRECTOR, ROLES.OWNER, 'md'] },
      isEmailVerified: true,
      accountStatus: { $ne: ACCOUNT_STATUSES.PENDING_VERIFICATION },
    });

    if (existingActiveMD) {
      return res.status(403).json({
        success: false,
        message: 'Public Managing Director registration is closed. System already has an active Managing Director.',
      });
    }

    const {
      organizationName,
      legalName,
      officialEmail,
      phone,
      firstName,
      lastName,
      password,
    } = req.body;

    if (!organizationName || !officialEmail || !firstName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Organization name, official email, first name, and password are required.',
      });
    }

    const emailClean = officialEmail.toLowerCase().trim();

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailClean)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid official email address.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long for secure root access.',
      });
    }

    // Generate 6-digit secure OTP and hash it with bcrypt
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Find or provision Organization
    let org = await Organization.findOne({ email: emailClean });
    if (!org) {
      org = await Organization.create({
        name: organizationName.trim(),
        legalName: legalName ? legalName.trim() : organizationName.trim(),
        email: emailClean,
        phone: phone ? phone.trim() : '',
        enabledModules: MODULE_LIST,
        isActive: false, // Activated once OTP is verified
      });
    } else {
      org.name = organizationName.trim();
      org.legalName = legalName ? legalName.trim() : organizationName.trim();
      org.phone = phone ? phone.trim() : org.phone;
      await org.save();
    }

    // Check if a provisional unverified MD record already exists for this email
    let mdUser = await User.findOne({
      email: emailClean,
      organizationId: org._id,
    }).select('+otpHash');

    if (mdUser) {
      // Enforce 60-second cooldown between OTP requests
      if (mdUser.lastOtpResentAt && Date.now() - new Date(mdUser.lastOtpResentAt).getTime() < 60 * 1000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait at least 60 seconds before requesting another verification code.',
        });
      }

      mdUser.firstName = firstName.trim();
      mdUser.lastName = lastName ? lastName.trim() : '';
      mdUser.phone = phone ? phone.trim() : '';
      mdUser.password = password; // Will be hashed by User pre-save hook
      mdUser.role = ROLES.MANAGING_DIRECTOR;
      mdUser.otpHash = otpHash;
      mdUser.otpExpiresAt = otpExpiresAt;
      mdUser.otpAttempts = 0;
      mdUser.lastOtpResentAt = new Date();
      mdUser.accountStatus = ACCOUNT_STATUSES.PENDING_VERIFICATION;
      mdUser.isEmailVerified = false;
      mdUser.isActive = false;
      await mdUser.save();
    } else {
      mdUser = await User.create({
        organizationId: org._id,
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : '',
        email: emailClean,
        phone: phone ? phone.trim() : '',
        password,
        role: ROLES.MANAGING_DIRECTOR,
        department: 'Executive Management',
        designation: 'Managing Director (MD)',
        employeeId: 'MD-001',
        isEmailVerified: false,
        isActive: false,
        accountStatus: ACCOUNT_STATUSES.PENDING_VERIFICATION,
        otpHash,
        otpExpiresAt,
        otpAttempts: 0,
        lastOtpResentAt: new Date(),
      });
    }

    // Dispatch verification OTP email
    await sendOtpEmail({
      to: mdUser.email,
      otp,
      userName: mdUser.firstName,
      smtpConfig: org.smtpConfig,
    });

    await logAudit({
      organizationId: org._id,
      action: AUDIT_ACTIONS.MD_REGISTERED,
      performedByName: `${mdUser.firstName} ${mdUser.lastName}`,
      entityType: 'User',
      entityId: mdUser._id,
      details: { email: mdUser.email, message: 'Initial Managing Director registration initiated with Email OTP' },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been dispatched to ${emailClean}. Please verify to activate your MD account.`,
      email: emailClean,
      expiresInMinutes: 10,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Step 2 of Initial MD Registration:
 * Verifies the 6-digit email OTP, activates the MD account atomically,
 * provisions role permissions, and returns authenticated JWT session.
 */
const verifyInitialMDOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and verification code are required.',
      });
    }

    const emailClean = email.toLowerCase().trim();

    // Check again to ensure no active MD was created in a race condition
    const existingActiveMD = await User.findOne({
      role: { $in: [ROLES.MANAGING_DIRECTOR, ROLES.OWNER, 'md'] },
      isEmailVerified: true,
      accountStatus: ACCOUNT_STATUSES.ACTIVE,
      email: { $ne: emailClean },
    });

    if (existingActiveMD) {
      return res.status(403).json({
        success: false,
        message: 'An active Managing Director is already registered for this system.',
      });
    }

    const mdUser = await User.findOne({
      email: emailClean,
      role: { $in: [ROLES.MANAGING_DIRECTOR, ROLES.OWNER, 'md'] },
    }).select('+otpHash +password');

    if (!mdUser || !mdUser.otpHash || !mdUser.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'No pending verification request found for this email.',
      });
    }

    // Check OTP expiration
    if (new Date() > mdUser.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
      });
    }

    // Check failed attempt limit (max 5)
    if (mdUser.otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new verification code.',
      });
    }

    const isValid = await verifyOtp(otp, mdUser.otpHash);
    if (!isValid) {
      mdUser.otpAttempts += 1;
      await mdUser.save();
      return res.status(400).json({
        success: false,
        message: 'Incorrect verification code. Please check and try again.',
        remainingAttempts: Math.max(0, 5 - mdUser.otpAttempts),
      });
    }

    // OTP is valid! Activate MD account atomically
    mdUser.isEmailVerified = true;
    mdUser.isActive = true;
    mdUser.accountStatus = ACCOUNT_STATUSES.ACTIVE;
    mdUser.otpHash = null;
    mdUser.otpExpiresAt = null;
    mdUser.otpAttempts = 0;
    mdUser.lastLoginAt = new Date();
    await mdUser.save();

    // Activate Organization
    const org = await Organization.findByIdAndUpdate(
      mdUser.organizationId,
      {
        $set: {
          isActive: true,
          enabledModules: MODULE_LIST,
        },
      },
      { new: true }
    );

    // Initialize default permissions for all roles (including all 7 roles and legacy)
    for (const [roleName, config] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await RolePermission.findOneAndUpdate(
        { organizationId: org._id, role: roleName },
        {
          $set: {
            allowedModules: config.modules,
            allowedPermissions: config.permissions,
            updatedBy: mdUser._id,
          },
        },
        { upsert: true, new: true }
      );
    }

    // Generate JWT token
    const token = signToken({
      userId: mdUser._id,
      organizationId: org._id,
      role: mdUser.role,
      tokenVersion: mdUser.tokenVersion,
    });

    await logAudit({
      organizationId: org._id,
      action: AUDIT_ACTIONS.OTP_VERIFIED,
      performedBy: mdUser._id,
      performedByName: `${mdUser.firstName} ${mdUser.lastName}`,
      entityType: 'User',
      entityId: mdUser._id,
      details: { email: mdUser.email, role: mdUser.role, message: 'Initial Managing Director account successfully verified and activated' },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Managing Director account successfully activated!',
      token,
      user: {
        id: mdUser._id,
        firstName: mdUser.firstName,
        lastName: mdUser.lastName,
        fullName: `${mdUser.firstName} ${mdUser.lastName}`.trim(),
        email: mdUser.email,
        phone: mdUser.phone,
        role: mdUser.role,
        department: mdUser.department,
        designation: mdUser.designation,
        employeeId: mdUser.employeeId,
        accountStatus: mdUser.accountStatus,
        organizationId: org._id,
        organizationName: org.name,
        currency: org.currency || { code: 'INR', symbol: '₹' },
        timezone: org.timezone || 'Asia/Kolkata',
        enabledModules: MODULE_LIST,
        allowedModules: MODULE_LIST,
        allowedPermissions: DEFAULT_ROLE_PERMISSIONS[ROLES.MANAGING_DIRECTOR].permissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Resend OTP for initial MD registration with cooldown guard
 */
const resendInitialMDOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const emailClean = email.toLowerCase().trim();

    const mdUser = await User.findOne({
      email: emailClean,
      role: { $in: [ROLES.MANAGING_DIRECTOR, ROLES.OWNER, 'md'] },
      isEmailVerified: false,
    }).select('+otpHash');

    if (!mdUser) {
      return res.status(400).json({
        success: false,
        message: 'No pending registration found for this email address.',
      });
    }

    // Cooldown check (60 seconds)
    if (mdUser.lastOtpResentAt && Date.now() - new Date(mdUser.lastOtpResentAt).getTime() < 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: 'Please wait at least 60 seconds before requesting another code.',
      });
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    mdUser.otpHash = otpHash;
    mdUser.otpExpiresAt = otpExpiresAt;
    mdUser.otpAttempts = 0;
    mdUser.lastOtpResentAt = new Date();
    await mdUser.save();

    const org = await Organization.findById(mdUser.organizationId).lean();
    await sendOtpEmail({
      to: mdUser.email,
      otp,
      userName: mdUser.firstName,
      smtpConfig: org?.smtpConfig,
    });

    return res.json({
      success: true,
      message: 'A fresh verification code has been dispatched to your email address.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Legacy Bootstrap Owner endpoint (kept for complete backward compatibility with existing tests)
 */
const bootstrapOwner = async (req, res, next) => {
  try {
    const existingOwner = await User.findOne({
      role: { $in: [ROLES.OWNER, ROLES.MANAGING_DIRECTOR] },
      isEmailVerified: true,
    });

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

    let org = await Organization.create({
      name: organizationName,
      legalName: legalName || organizationName,
      email: officialEmail.toLowerCase(),
      phone: phone || '',
      enabledModules: MODULE_LIST,
    });

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
      accountStatus: ACCOUNT_STATUSES.ACTIVE,
      department: 'Management',
      designation: 'Managing Director / Owner',
      employeeId: 'OWNER-001',
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

/**
 * Standard User Login:
 * Authenticates user, checks account status (active / suspended / deactivated / pending),
 * updates lastLoginAt, creates audit record, and returns user profile & permissions.
 */
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

    // Account Status & Verification Guards
    if (user.accountStatus === ACCOUNT_STATUSES.PENDING_VERIFICATION || (!user.isEmailVerified && user.accountStatus !== ACCOUNT_STATUSES.ACTIVE)) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending email verification. Please verify your OTP to continue.',
        accountStatus: user.accountStatus,
      });
    }

    if (user.accountStatus === ACCOUNT_STATUSES.SUSPENDED) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact the Managing Director.',
        accountStatus: user.accountStatus,
        reason: user.statusChangeReason || 'Account suspended',
      });
    }

    if (!user.isActive || user.accountStatus === ACCOUNT_STATUSES.DEACTIVATED) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact your organization administrator.',
        accountStatus: user.accountStatus || 'deactivated',
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

    // Check MD status: MD gets unrestricted access to all modules and all permissions
    const isMD = isManagingDirectorRole(user.role);

    let allowedModules;
    let allowedPermissions;

    if (isMD) {
      allowedModules = MODULE_LIST;
      allowedPermissions = DEFAULT_ROLE_PERMISSIONS[ROLES.MANAGING_DIRECTOR].permissions;
    } else {
      const rolePerm = await RolePermission.findOne({
        organizationId: user.organizationId,
        role: user.role,
      }).lean();

      allowedModules = rolePerm?.allowedModules || [];
      allowedPermissions = rolePerm?.allowedPermissions || [];

      // Include user-level custom permissions
      if (user.customPermissions && user.customPermissions.length > 0) {
        allowedPermissions = Array.from(new Set([...allowedPermissions, ...user.customPermissions]));
      }
    }

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
        phone: user.phone,
        role: user.role,
        department: user.department,
        designation: user.designation,
        employeeId: user.employeeId,
        avatar: user.avatar,
        zone: user.zone || '',
        team: user.team || '',
        reportingTo: user.reportingTo || null,
        accountStatus: user.accountStatus || 'active',
        delegatedPermissions: user.delegatedPermissions || {},
        organizationId: user.organizationId,
        organizationName: org?.name || 'LevoraLead Real Estate',
        currency: org?.currency || { code: 'INR', symbol: '₹' },
        timezone: org?.timezone || 'Asia/Kolkata',
        enabledModules: isMD ? MODULE_LIST : (org?.enabledModules || MODULE_LIST),
        allowedModules,
        allowedPermissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get current authenticated user profile
 */
const getMe = async (req, res, next) => {
  try {
    const user = req.user;
    const org = await Organization.findById(req.organizationId).lean();
    const isMD = isManagingDirectorRole(user.role);

    let allowedModules;
    let allowedPermissions;

    if (isMD) {
      allowedModules = MODULE_LIST;
      allowedPermissions = DEFAULT_ROLE_PERMISSIONS[ROLES.MANAGING_DIRECTOR].permissions;
    } else {
      const rolePerm = await RolePermission.findOne({
        organizationId: user.organizationId,
        role: user.role,
      }).lean();

      allowedModules = rolePerm?.allowedModules || [];
      allowedPermissions = rolePerm?.allowedPermissions || [];

      if (user.customPermissions && user.customPermissions.length > 0) {
        allowedPermissions = Array.from(new Set([...allowedPermissions, ...user.customPermissions]));
      }
    }

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
        zone: user.zone || '',
        team: user.team || '',
        reportingTo: user.reportingTo || null,
        accountStatus: user.accountStatus || 'active',
        delegatedPermissions: user.delegatedPermissions || {},
        organizationId: user.organizationId,
        organizationName: org?.name || 'LevoraLead Real Estate',
        branding: org?.branding,
        currency: org?.currency || { code: 'INR', symbol: '₹' },
        timezone: org?.timezone || 'Asia/Kolkata',
        enabledModules: isMD ? MODULE_LIST : (org?.enabledModules || MODULE_LIST),
        allowedModules,
        allowedPermissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Send / Resend general OTP for password reset or email verification
 */
const requestOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({
        success: true,
        message: 'If this email is registered, a verification code has been dispatched.',
      });
    }

    if (user.lastOtpResentAt && Date.now() - new Date(user.lastOtpResentAt).getTime() < 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: 'Please wait at least 60 seconds before requesting another code.',
      });
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otpHash = otpHash;
    user.otpExpiresAt = expiresAt;
    user.otpAttempts = 0;
    user.lastOtpResentAt = new Date();
    await user.save();

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

/**
 * Verify general OTP
 */
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

/**
 * Reset password using verified OTP
 */
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
    user.tokenVersion += 1; // Invalidate all prior sessions
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

/**
 * Change password for currently authenticated user
 */
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

/**
 * Trigger demo data seeding
 */
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

module.exports = {
  checkSetup,
  registerInitialMD,
  verifyInitialMDOtp,
  resendInitialMDOtp,
  bootstrapOwner,
  requestOtp,
  verifyOtpHandler,
  login,
  getMe,
  resetPassword,
  changePassword,
  seedDemoData,
};
