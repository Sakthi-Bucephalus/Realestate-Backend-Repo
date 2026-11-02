/**
 * LEVORALEAD - Organizational Roles & System Hierarchies
 * Defines the 7 Core Organizational Roles plus backward-compatible legacy roles.
 */

const ROLES = {
  // Official 7 Organizational Roles
  MANAGING_DIRECTOR: 'managing_director',
  DIRECTOR: 'director',
  BUSINESS_MANAGER: 'business_manager',
  ZONAL_MANAGER: 'zonal_manager',
  SALES_MANAGER: 'sales_manager',
  MEDIATOR: 'mediator',
  REFERRALS: 'referrals',

  // Legacy system roles preserved for backward compatibility
  OWNER: 'owner',
  ADMIN: 'admin',
  HR: 'hr',
  EMPLOYEE: 'employee',
};

// The 7 official organizational roles
const ORGANIZATIONAL_ROLES = [
  ROLES.MANAGING_DIRECTOR,
  ROLES.DIRECTOR,
  ROLES.BUSINESS_MANAGER,
  ROLES.ZONAL_MANAGER,
  ROLES.SALES_MANAGER,
  ROLES.MEDIATOR,
  ROLES.REFERRALS,
];

// All valid role strings for DB validation and API checks
const ROLE_LIST = [
  ...ORGANIZATIONAL_ROLES,
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.HR,
  ROLES.EMPLOYEE,
];

// Formal role display labels
const ROLE_LABELS = {
  [ROLES.MANAGING_DIRECTOR]: 'Managing Director (MD)',
  [ROLES.DIRECTOR]: 'Director',
  [ROLES.BUSINESS_MANAGER]: 'Business Manager',
  [ROLES.ZONAL_MANAGER]: 'Zonal Manager',
  [ROLES.SALES_MANAGER]: 'Sales Manager',
  [ROLES.MEDIATOR]: 'Mediator',
  [ROLES.REFERRALS]: 'Referrals',
  // Legacy labels
  [ROLES.OWNER]: 'Managing Director (Legacy Owner)',
  [ROLES.ADMIN]: 'Administrator',
  [ROLES.HR]: 'HR Manager',
  [ROLES.EMPLOYEE]: 'Sales Executive',
};

// Default organizational hierarchy rank (lower number = higher rank)
const ROLE_RANKS = {
  [ROLES.MANAGING_DIRECTOR]: 1,
  [ROLES.OWNER]: 1, // Legacy owner has MD-level rank
  [ROLES.DIRECTOR]: 2,
  [ROLES.BUSINESS_MANAGER]: 3,
  [ROLES.ZONAL_MANAGER]: 4,
  [ROLES.SALES_MANAGER]: 5,
  [ROLES.MEDIATOR]: 6,
  [ROLES.REFERRALS]: 6,
  [ROLES.ADMIN]: 2,
  [ROLES.HR]: 3,
  [ROLES.EMPLOYEE]: 5,
};

/**
 * Checks whether a given role string represents the Managing Director (including legacy owner)
 */
const isManagingDirectorRole = (role) => {
  return role === ROLES.MANAGING_DIRECTOR || role === ROLES.OWNER || role === 'md';
};

module.exports = {
  ROLES,
  ORGANIZATIONAL_ROLES,
  ROLE_LIST,
  ROLE_LABELS,
  ROLE_RANKS,
  isManagingDirectorRole,
};
