const { MODULES } = require('./modules');
const { ROLES } = require('./roles');

const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  EXPORT: 'export',
  ASSIGN: 'assign',
  APPROVE: 'approve',
  MANAGE_USERS: 'manage_users',
  MANAGE_PERMISSIONS: 'manage_permissions',
};

const ACTION_LIST = Object.values(ACTIONS);

// Generate permission string helper e.g. "leads.view"
const createPermissionKey = (moduleName, action) => `${moduleName}.${action}`;

const ALL_MODULES = Object.values(MODULES);
const ALL_PERMISSIONS = ALL_MODULES.flatMap((m) =>
  ACTION_LIST.map((action) => createPermissionKey(m, action))
);

// Default role permission mapping template for all 7 organizational roles + legacy
const DEFAULT_ROLE_PERMISSIONS = {
  // 1. Managing Director: Universal unrestricted access
  [ROLES.MANAGING_DIRECTOR]: {
    modules: ALL_MODULES,
    permissions: ALL_PERMISSIONS,
  },
  [ROLES.OWNER]: {
    modules: ALL_MODULES,
    permissions: ALL_PERMISSIONS,
  },

  // 2. Director: High-level management, delegated business units & teams
  [ROLES.DIRECTOR]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.CUSTOMERS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.PAYMENTS,
      MODULES.EMPLOYEES,
      MODULES.REPORTS,
      MODULES.NOTIFICATIONS,
      MODULES.AUDIT_LOGS,
      MODULES.SETTINGS,
    ],
    permissions: [
      'dashboard.view', 'dashboard.export',
      'leads.view', 'leads.create', 'leads.edit', 'leads.delete', 'leads.export', 'leads.assign', 'leads.approve',
      'customers.view', 'customers.create', 'customers.edit', 'customers.export',
      'properties.view', 'properties.create', 'properties.edit', 'properties.export',
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.export', 'site_visits.assign',
      'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.export', 'bookings.approve',
      'payments.view', 'payments.create', 'payments.edit', 'payments.export', 'payments.approve',
      'employees.view', 'employees.create', 'employees.edit', 'employees.manage_users',
      'reports.view', 'reports.export',
      'notifications.view', 'notifications.edit',
      'audit_logs.view',
      'settings.view',
    ],
  },

  // 3. Business Manager: Oversees operations, business units, approvals
  [ROLES.BUSINESS_MANAGER]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.CUSTOMERS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.PAYMENTS,
      MODULES.EMPLOYEES,
      MODULES.REPORTS,
      MODULES.NOTIFICATIONS,
    ],
    permissions: [
      'dashboard.view', 'dashboard.export',
      'leads.view', 'leads.create', 'leads.edit', 'leads.export', 'leads.assign', 'leads.approve',
      'customers.view', 'customers.create', 'customers.edit', 'customers.export',
      'properties.view', 'properties.create', 'properties.edit', 'properties.export',
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.export', 'site_visits.assign',
      'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.export', 'bookings.approve',
      'payments.view', 'payments.create', 'payments.edit', 'payments.export',
      'employees.view',
      'reports.view', 'reports.export',
      'notifications.view',
    ],
  },

  // 4. Zonal Manager: Zone-level operations, teams, leads, visits
  [ROLES.ZONAL_MANAGER]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.CUSTOMERS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.PAYMENTS,
      MODULES.EMPLOYEES,
      MODULES.REPORTS,
      MODULES.NOTIFICATIONS,
    ],
    permissions: [
      'dashboard.view',
      'leads.view', 'leads.create', 'leads.edit', 'leads.assign', 'leads.export',
      'customers.view', 'customers.create', 'customers.edit',
      'properties.view', 'properties.export',
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.assign',
      'bookings.view', 'bookings.create', 'bookings.edit',
      'payments.view',
      'employees.view',
      'reports.view',
      'notifications.view',
    ],
  },

  // 5. Sales Manager: Team-level management, lead distribution, closings
  [ROLES.SALES_MANAGER]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.CUSTOMERS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.PAYMENTS,
      MODULES.NOTIFICATIONS,
      MODULES.REPORTS,
    ],
    permissions: [
      'dashboard.view',
      'leads.view', 'leads.create', 'leads.edit', 'leads.assign',
      'customers.view', 'customers.create', 'customers.edit',
      'properties.view',
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.assign',
      'bookings.view', 'bookings.create', 'bookings.edit',
      'payments.view',
      'reports.view',
      'notifications.view',
    ],
  },

  // 6. Mediator: Client intermediation, deal coordination, assigned site visits
  [ROLES.MEDIATOR]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.NOTIFICATIONS,
    ],
    permissions: [
      'dashboard.view',
      'leads.view', 'leads.create', 'leads.edit',
      'properties.view',
      'site_visits.view', 'site_visits.create', 'site_visits.edit',
      'bookings.view',
      'notifications.view',
    ],
  },

  // 7. Referrals: External partner referrals, lead submission, referral status
  [ROLES.REFERRALS]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.PROPERTIES,
      MODULES.NOTIFICATIONS,
    ],
    permissions: [
      'dashboard.view',
      'leads.view', 'leads.create',
      'properties.view',
      'notifications.view',
    ],
  },

  // Legacy roles backward compatibility
  [ROLES.ADMIN]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.CUSTOMERS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.BOOKINGS,
      MODULES.PAYMENTS,
      MODULES.EMPLOYEES,
      MODULES.REPORTS,
      MODULES.NOTIFICATIONS,
      MODULES.AUDIT_LOGS,
    ],
    permissions: [
      'dashboard.view', 'dashboard.export',
      'leads.view', 'leads.create', 'leads.edit', 'leads.delete', 'leads.export', 'leads.assign',
      'customers.view', 'customers.create', 'customers.edit', 'customers.export',
      'properties.view', 'properties.create', 'properties.edit', 'properties.delete', 'properties.export',
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.delete', 'site_visits.export', 'site_visits.assign',
      'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.export',
      'payments.view', 'payments.create', 'payments.edit', 'payments.export',
      'employees.view', 'employees.create', 'employees.edit',
      'reports.view', 'reports.export',
      'notifications.view', 'notifications.edit',
      'audit_logs.view',
    ],
  },
  [ROLES.HR]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.EMPLOYEES,
      MODULES.HR,
      MODULES.NOTIFICATIONS,
      MODULES.REPORTS,
    ],
    permissions: [
      'dashboard.view',
      'employees.view', 'employees.create', 'employees.edit', 'employees.export', 'employees.assign',
      'hr.view', 'hr.create', 'hr.edit', 'hr.delete', 'hr.export',
      'reports.view', 'reports.export',
      'notifications.view',
    ],
  },
  [ROLES.EMPLOYEE]: {
    modules: [
      MODULES.DASHBOARD,
      MODULES.LEADS,
      MODULES.PROPERTIES,
      MODULES.SITE_VISITS,
      MODULES.NOTIFICATIONS,
    ],
    permissions: [
      'dashboard.view',
      'leads.view', 'leads.create', 'leads.edit',
      'properties.view',
      'site_visits.view', 'site_visits.create', 'site_visits.edit',
      'notifications.view',
    ],
  },
};

module.exports = {
  ACTIONS,
  ACTION_LIST,
  DEFAULT_ROLE_PERMISSIONS,
  createPermissionKey,
  ALL_MODULES,
  ALL_PERMISSIONS,
};
