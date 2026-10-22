const { MODULES } = require('./modules');
const { ROLES } = require('./roles');

const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  EXPORT: 'export',
  ASSIGN: 'assign',
  MANAGE_ACCESS: 'manage_access',
};

const ACTION_LIST = Object.values(ACTIONS);

// Generate permission string helper e.g. "leads.view"
const createPermissionKey = (moduleName, action) => `${moduleName}.${action}`;

// Default role permission mapping template
const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.OWNER]: {
    modules: Object.values(MODULES),
    permissions: Object.values(MODULES).flatMap((m) =>
      ACTION_LIST.map((action) => createPermissionKey(m, action))
    ),
  },
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
      // Dashboard
      'dashboard.view', 'dashboard.export',
      // Leads
      'leads.view', 'leads.create', 'leads.edit', 'leads.delete', 'leads.export', 'leads.assign',
      // Customers
      'customers.view', 'customers.create', 'customers.edit', 'customers.export',
      // Properties
      'properties.view', 'properties.create', 'properties.edit', 'properties.delete', 'properties.export',
      // Site Visits
      'site_visits.view', 'site_visits.create', 'site_visits.edit', 'site_visits.delete', 'site_visits.export', 'site_visits.assign',
      // Bookings
      'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.export',
      // Payments
      'payments.view', 'payments.create', 'payments.edit', 'payments.export',
      // Employees
      'employees.view', 'employees.create', 'employees.edit',
      // Reports
      'reports.view', 'reports.export',
      // Notifications
      'notifications.view', 'notifications.edit',
      // Audit
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
};
