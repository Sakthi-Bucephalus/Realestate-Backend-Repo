const Organization = require('../models/Organization');
const RolePermission = require('../models/RolePermission');
const AuditLog = require('../models/AuditLog');
const { MODULE_LIST } = require('../constants/modules');
const { ROLE_LIST, ROLES } = require('../constants/roles');
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');
const { invalidateRolePermissionsCache } = require('../middleware/rbac');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');

// 1. Get Organization Settings
const getOrgSettings = async (req, res, next) => {
  try {
    const org = await Organization.findById(req.organizationId).lean();
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    // Never send raw SMTP password to client; send safe config status
    const safeSmtp = org.smtpConfig
      ? {
          host: org.smtpConfig.host || '',
          port: org.smtpConfig.port || 587,
          secure: org.smtpConfig.secure || false,
          user: org.smtpConfig.user || '',
          isPasswordConfigured: !!org.smtpConfig.pass,
          fromEmail: org.smtpConfig.fromEmail || '',
          isConfigured: org.smtpConfig.isConfigured || false,
          lastTestedAt: org.smtpConfig.lastTestedAt || null,
        }
      : null;

    return res.json({
      success: true,
      data: {
        ...org,
        smtpConfig: safeSmtp,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. Update Organization Profile
const updateOrgProfile = async (req, res, next) => {
  try {
    const org = await Organization.findById(req.organizationId);
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const {
      name,
      legalName,
      phone,
      website,
      address,
      timezone,
      currency,
      branding,
      logo,
    } = req.body;

    if (name) org.name = name.trim();
    if (legalName !== undefined) org.legalName = legalName.trim();
    if (phone !== undefined) org.phone = phone.trim();
    if (website !== undefined) org.website = website.trim();
    if (address) org.address = { ...org.address, ...address };
    if (timezone) org.timezone = timezone;
    if (currency) org.currency = { ...org.currency, ...currency };
    if (branding) org.branding = { ...org.branding, ...branding };
    if (logo !== undefined) org.logo = logo;

    await org.save();

    await logAudit({
      organizationId: org._id,
      action: 'ORGANIZATION_PROFILE_UPDATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Organization',
      entityId: org._id,
      details: { updates: req.body },
      req,
    });

    return res.json({
      success: true,
      message: 'Organization profile successfully updated',
      data: org,
    });
  } catch (err) {
    next(err);
  }
};

// 3. Save SMTP Settings
const saveSmtpSettings = async (req, res, next) => {
  try {
    const { host, port, secure, user, pass, fromEmail } = req.body;
    const org = await Organization.findById(req.organizationId);

    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    org.smtpConfig.host = host || '';
    org.smtpConfig.port = Number(port) || 587;
    org.smtpConfig.secure = !!secure;
    org.smtpConfig.user = user || '';
    org.smtpConfig.fromEmail = fromEmail || '';

    // Only update pass if provided
    if (pass) {
      org.smtpConfig.pass = pass;
    }

    org.smtpConfig.isConfigured = !!(org.smtpConfig.host && org.smtpConfig.user);
    await org.save();

    return res.json({
      success: true,
      message: 'SMTP settings saved successfully.',
    });
  } catch (err) {
    next(err);
  }
};

// 4. Test SMTP Email Delivery
const testSmtpSettings = async (req, res, next) => {
  try {
    const { testRecipient } = req.body;
    const recipient = testRecipient || req.user.email;

    const org = await Organization.findById(req.organizationId);
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const testResult = await sendEmail({
      to: recipient,
      subject: 'EstateFlow SMTP Configuration Test',
      html: `
        <h3>EstateFlow SMTP Test Verification</h3>
        <p>This email confirms that your SMTP server is configured and communicating correctly with EstateFlow.</p>
        <p>Tested at: <strong>${new Date().toLocaleString()}</strong></p>
      `,
      text: `EstateFlow SMTP Test Verification at ${new Date().toLocaleString()}`,
      smtpConfig: org.smtpConfig,
    });

    org.smtpConfig.lastTestedAt = new Date();
    await org.save();

    return res.json({
      success: true,
      message: `Test email dispatched to ${recipient}!`,
      info: testResult,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: `SMTP Connection test failed: ${err.message}`,
    });
  }
};

// 5. Get Module Access Control Configuration (Modules & Role Permissions)
const getModuleAccessControl = async (req, res, next) => {
  try {
    const org = await Organization.findById(req.organizationId).lean();
    const rolePermissions = await RolePermission.find({
      organizationId: req.organizationId,
    }).lean();

    const roleMap = {};
    ROLE_LIST.forEach((role) => {
      const found = rolePermissions.find((r) => r.role === role);
      if (found) {
        roleMap[role] = {
          allowedModules: found.allowedModules,
          allowedPermissions: found.allowedPermissions,
        };
      } else {
        const defaults = DEFAULT_ROLE_PERMISSIONS[role] || { modules: [], permissions: [] };
        roleMap[role] = {
          allowedModules: defaults.modules,
          allowedPermissions: defaults.permissions,
        };
      }
    });

    return res.json({
      success: true,
      data: {
        allAvailableModules: MODULE_LIST,
        organizationEnabledModules: org?.enabledModules || MODULE_LIST,
        rolePermissions: roleMap,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 6. Update Organization-wide Enabled Modules (Owner Only)
const updateEnabledModules = async (req, res, next) => {
  try {
    const { enabledModules } = req.body;
    if (!Array.isArray(enabledModules)) {
      return res.status(400).json({ success: false, message: 'enabledModules must be an array of module keys.' });
    }

    // Always keep DASHBOARD and SETTINGS enabled
    const sanitizedModules = Array.from(new Set(['dashboard', 'settings', ...enabledModules]));

    const org = await Organization.findByIdAndUpdate(
      req.organizationId,
      { $set: { enabledModules: sanitizedModules } },
      { new: true }
    );

    invalidateRolePermissionsCache(req.organizationId);

    await logAudit({
      organizationId: org._id,
      action: 'MODULES_CONFIG_UPDATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'Organization',
      entityId: org._id,
      details: { enabledModules: sanitizedModules },
      req,
    });

    return res.json({
      success: true,
      message: 'Module availability updated for organization',
      data: org.enabledModules,
    });
  } catch (err) {
    next(err);
  }
};

// 7. Update Role Permission Matrix
const updateRolePermissions = async (req, res, next) => {
  try {
    const { role, allowedModules, allowedPermissions } = req.body;

    if (!role || !ROLE_LIST.includes(role)) {
      return res.status(400).json({ success: false, message: 'Valid role is required.' });
    }

    if (role === ROLES.OWNER) {
      return res.status(400).json({
        success: false,
        message: 'Owner role permissions are system-defined and cannot be restricted.',
      });
    }

    const record = await RolePermission.findOneAndUpdate(
      { organizationId: req.organizationId, role },
      {
        $set: {
          allowedModules: allowedModules || [],
          allowedPermissions: allowedPermissions || [],
          updatedBy: req.user._id,
        },
      },
      { upsert: true, new: true }
    );

    invalidateRolePermissionsCache(req.organizationId);

    await logAudit({
      organizationId: req.organizationId,
      action: 'ROLE_PERMISSIONS_UPDATED',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName} ${req.user.lastName}`,
      entityType: 'RolePermission',
      entityId: record._id,
      details: { role, allowedModules, allowedPermissions },
      req,
    });

    return res.json({
      success: true,
      message: `Permissions updated for role: ${role}`,
      data: record,
    });
  } catch (err) {
    next(err);
  }
};

// 8. Get Audit Logs
const getAuditLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 30,
      action = '',
      entityType = '',
      startDate = '',
      endDate = '',
    } = req.query;

    const query = { organizationId: req.organizationId };

    if (action) query.action = action;
    if (entityType) query.entityType = entityType;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 100);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('performedBy', 'firstName lastName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: logs,
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

module.exports = {
  getOrgSettings,
  updateOrgProfile,
  saveSmtpSettings,
  testSmtpSettings,
  getModuleAccessControl,
  updateEnabledModules,
  updateRolePermissions,
  getAuditLogs,
};
