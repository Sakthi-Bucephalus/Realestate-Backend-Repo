const MODULES = {
  DASHBOARD: 'dashboard',
  LEADS: 'leads',
  CUSTOMERS: 'customers',
  PROPERTIES: 'properties',
  SITE_VISITS: 'site_visits',
  BOOKINGS: 'bookings',
  PAYMENTS: 'payments',
  EMPLOYEES: 'employees',
  HR: 'hr',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  MODULE_ACCESS: 'module_access',
  AUDIT_LOGS: 'audit_logs',
  SETTINGS: 'settings',
};

const MODULE_LIST = Object.values(MODULES);

module.exports = {
  MODULES,
  MODULE_LIST,
};
