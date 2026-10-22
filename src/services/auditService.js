const AuditLog = require('../models/AuditLog');

const logAudit = async ({
  organizationId = null,
  action,
  performedBy = null,
  performedByName = 'System',
  entityType,
  entityId = '',
  details = {},
  req = null,
}) => {
  try {
    const ipAddress = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') : '';
    const userAgent = req ? (req.headers['user-agent'] || '') : '';

    await AuditLog.create({
      organizationId,
      action,
      performedBy,
      performedByName,
      entityType,
      entityId: String(entityId),
      details,
      ipAddress: String(ipAddress),
      userAgent: String(userAgent),
    });
  } catch (err) {
    console.error('[AuditService] Failed to record audit log:', err.message);
  }
};

module.exports = {
  logAudit,
};
