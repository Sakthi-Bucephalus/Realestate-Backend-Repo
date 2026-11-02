const { ROLES, isManagingDirectorRole } = require('../constants/roles');
const Organization = require('../models/Organization');
const RolePermission = require('../models/RolePermission');
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants/permissions');

// In-memory cache for role permissions with 60s TTL to optimize latency
const permissionsCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

const getCachedRolePermissions = async (organizationId, role) => {
  const cacheKey = `${organizationId}_${role}`;
  const cached = permissionsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  let record = await RolePermission.findOne({ organizationId, role }).lean();

  if (!record) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role] || { modules: [], permissions: [] };
    record = {
      allowedModules: defaults.modules,
      allowedPermissions: defaults.permissions,
    };
  }

  permissionsCache.set(cacheKey, {
    data: record,
    timestamp: Date.now(),
  });

  return record;
};

const invalidateRolePermissionsCache = (organizationId) => {
  for (const key of permissionsCache.keys()) {
    if (key.startsWith(`${organizationId}_`)) {
      permissionsCache.delete(key);
    }
  }
};

/**
 * Require one or more specific roles.
 * MD (Managing Director and legacy Owner) always bypasses role restrictions.
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Managing Director (and legacy owner) has unrestricted, universal access across all endpoints
    if (isManagingDirectorRole(req.user.role)) {
      return next();
    }

    // Role aliases (e.g. OWNER matches MANAGING_DIRECTOR)
    const matchingRoles = [...roles];
    if (roles.includes(ROLES.MANAGING_DIRECTOR)) {
      matchingRoles.push(ROLES.OWNER);
    }
    if (roles.includes(ROLES.OWNER)) {
      matchingRoles.push(ROLES.MANAGING_DIRECTOR);
    }

    if (!matchingRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires one of the following roles: [${roles.join(', ')}]`,
      });
    }

    next();
  };
};

/**
 * Require access to a module.
 * MD (Managing Director) always bypasses module restrictions.
 */
const requireModule = (moduleName) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Managing Director has unconditional, universal access to every module
      if (isManagingDirectorRole(req.user.role)) {
        return next();
      }

      // Check organization-wide enabled modules for subordinate users
      const org = await Organization.findById(req.organizationId).lean();
      if (!org || !org.enabledModules || !org.enabledModules.includes(moduleName)) {
        return res.status(403).json({
          success: false,
          message: `Module "${moduleName}" is disabled for your organization. Please contact the Managing Director.`,
          moduleDisabled: true,
        });
      }

      // Director delegated module access check
      if (req.user.role === ROLES.DIRECTOR && req.user.delegatedPermissions?.allowedModules?.length) {
        if (!req.user.delegatedPermissions.allowedModules.includes(moduleName)) {
          return res.status(403).json({
            success: false,
            message: `Your delegated Director permissions do not include the "${moduleName}" module.`,
          });
        }
      }

      // Check role module permission from DB or defaults
      const rolePerms = await getCachedRolePermissions(req.organizationId, req.user.role);
      const isAllowed = rolePerms.allowedModules && rolePerms.allowedModules.includes(moduleName);

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: `Your role (${req.user.role}) does not have permission to access the "${moduleName}" module.`,
        });
      }

      next();
    } catch (err) {
      console.error('[RBAC] requireModule error:', err.message);
      return res.status(500).json({ success: false, message: 'Authorization check failed' });
    }
  };
};

/**
 * Require a granular action permission key e.g. "leads.edit".
 * MD (Managing Director) always bypasses permission restrictions.
 */
const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Managing Director has universal action permission across all modules
      if (isManagingDirectorRole(req.user.role)) {
        return next();
      }

      // Check user-level custom permissions override
      if (req.user.customPermissions && req.user.customPermissions.includes(permissionKey)) {
        return next();
      }

      // Director delegated permission check for specific actions
      if (req.user.role === ROLES.DIRECTOR && req.user.delegatedPermissions) {
        if (permissionKey.endsWith('.export') && req.user.delegatedPermissions.canExportData) {
          return next();
        }
        if (permissionKey === 'bookings.approve' && req.user.delegatedPermissions.canApproveBookings) {
          return next();
        }
        if (permissionKey === 'payments.approve' && req.user.delegatedPermissions.canApprovePayments) {
          return next();
        }
      }

      // Check role permissions from DB
      const rolePerms = await getCachedRolePermissions(req.organizationId, req.user.role);
      const hasPerm = rolePerms.allowedPermissions && rolePerms.allowedPermissions.includes(permissionKey);

      if (!hasPerm) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: Missing required permission: "${permissionKey}".`,
        });
      }

      next();
    } catch (err) {
      console.error('[RBAC] requirePermission error:', err.message);
      return res.status(500).json({ success: false, message: 'Permission check failed' });
    }
  };
};

module.exports = {
  requireRole,
  requireModule,
  requirePermission,
  invalidateRolePermissionsCache,
  getCachedRolePermissions,
};
