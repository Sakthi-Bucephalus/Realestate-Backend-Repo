/**
 * LEVORALEAD - Centralized Data Scope & Authorization Helper
 * Enforces organization boundaries and hierarchy-based data filtering.
 *
 * CRITICAL RULE:
 * Managing Director (MD) has UNRESTRICTED access to all organization records.
 * MD is completely exempt from zone, team, or assigned-lead restrictions.
 */

const { ROLES, isManagingDirectorRole } = require('../constants/roles');

/**
 * Builds a query object enforcing role-level and data-level access control.
 *
 * @param {Object} user - The authenticated user (req.user)
 * @param {String} entityType - The entity type ('leads', 'properties', 'site_visits', 'bookings', 'payments', 'customers', 'employees')
 * @param {Object} baseQuery - Existing query filters from the request
 * @returns {Object} Final mongo filter query
 */
const buildDataScopeQuery = (user, entityType, baseQuery = {}) => {
  if (!user || !user.organizationId) {
    return { ...baseQuery };
  }

  const query = {
    organizationId: user.organizationId,
    ...baseQuery,
  };

  // 1. Managing Director & Legacy Owner: Absolute unrestricted organizational access
  if (isManagingDirectorRole(user.role)) {
    return query;
  }

  // 2. Director: Access determined by MD delegation configuration
  if (user.role === ROLES.DIRECTOR) {
    const delegation = user.delegatedPermissions || {};
    // If specific zones are delegated, scope to those zones
    if (delegation.managedZones && delegation.managedZones.length > 0) {
      if (['leads', 'properties', 'site_visits'].includes(entityType)) {
        query.$or = [
          { zone: { $in: delegation.managedZones } },
          { preferredLocation: { $in: delegation.managedZones } },
          { 'location.city': { $in: delegation.managedZones } },
          { assignedTo: user._id },
        ];
      }
    }
    // If specific teams are delegated, scope to those teams
    if (delegation.managedTeams && delegation.managedTeams.length > 0) {
      if (['leads', 'bookings', 'site_visits'].includes(entityType)) {
        query.team = { $in: delegation.managedTeams };
      }
    }
    // Otherwise, Director has broad access across their organization
    return query;
  }

  // 3. Business Manager: Access assigned business units, zones, or teams
  if (user.role === ROLES.BUSINESS_MANAGER) {
    if (user.zone) {
      if (['leads', 'properties', 'site_visits'].includes(entityType)) {
        query.$or = [
          { zone: user.zone },
          { preferredLocation: new RegExp(user.zone, 'i') },
          { 'location.city': new RegExp(user.zone, 'i') },
          { assignedTo: user._id },
        ];
      }
    }
    return query;
  }

  // 4. Zonal Manager: Restrict to authorized zone
  if (user.role === ROLES.ZONAL_MANAGER) {
    if (user.zone) {
      if (['leads', 'properties', 'site_visits'].includes(entityType)) {
        query.$or = [
          { zone: user.zone },
          { preferredLocation: new RegExp(user.zone, 'i') },
          { 'location.city': new RegExp(user.zone, 'i') },
          { assignedTo: user._id },
        ];
      }
    }
    return query;
  }

  // 5. Sales Manager: Restrict to team records
  if (user.role === ROLES.SALES_MANAGER) {
    if (user.team) {
      if (['leads', 'site_visits', 'bookings'].includes(entityType)) {
        query.$or = [
          { team: user.team },
          { assignedTo: user._id },
        ];
      }
    } else {
      query.assignedTo = user._id;
    }
    return query;
  }

  // 6. Mediator / Referrals / Employee: Strictly restricted to individually assigned or created records
  if (
    user.role === ROLES.MEDIATOR ||
    user.role === ROLES.REFERRALS ||
    user.role === ROLES.EMPLOYEE
  ) {
    if (['leads', 'site_visits', 'bookings'].includes(entityType)) {
      query.assignedTo = user._id;
    }
    return query;
  }

  // Legacy Admin & HR
  if (user.role === ROLES.ADMIN) {
    return query; // Admins have broad org access
  }

  if (user.role === ROLES.HR) {
    return query;
  }

  return query;
};

module.exports = {
  buildDataScopeQuery,
};
