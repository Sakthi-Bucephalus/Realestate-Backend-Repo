const { ROLES } = require('../constants/roles');
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

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role === ROLES.OWNER) {
      return next(); // Owner has universal access
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires one of the following roles: [${roles.join(', ')}]`,
      });
    }

    next();
  };
};

const requireModule = (moduleName) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Check organization-wide enabled modules
      const org = await Organization.findById(req.organizationId).lean();
      if (!org || !org.enabledModules || !org.enabledModules.includes(moduleName)) {
        return res.status(403).json({
          success: false,
          message: `Module "${moduleName}" is disabled for your organization. Please contact the owner.`,
          moduleDisabled: true,
        });
      }

      // Owner has access to all enabled modules
      if (req.user.role === ROLES.OWNER) {
        return next();
      }

      // Check role module permission
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

const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Owner bypass
      if (req.user.role === ROLES.OWNER) {
        return next();
      }

      // Check user custom permissions override
      if (req.user.customPermissions && req.user.customPermissions.includes(permissionKey)) {
        return next();
      }

      // Check role permissions
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
