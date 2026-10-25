const { verifyToken } = require('../utils/token');
const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No access token provided.',
      });
    }

    const decoded = verifyToken(token);

    const user = await User.findById(decoded.userId).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Account not found or has been removed.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact your organization administrator.',
        reason: user.statusChangeReason || 'Account deactivated',
      });
    }

    // Verify token version (session invalidation)
    if (decoded.tokenVersion && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        message: 'Session has expired or was revoked. Please sign in again.',
      });
    }

    req.user = user;
    req.organizationId = user.organizationId;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session token. Please sign in again.',
      });
    }

    console.error('[AuthMiddleware] Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server authentication error.',
    });
  }
};

module.exports = {
  requireAuth,
};
