const errorHandler = (err, req, res, next) => {
  console.error('[ServerError]', err.stack || err.message);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }

  // Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const keys = err.keyValue ? Object.keys(err.keyValue) : [];
    // For compound indexes partitioned by organizationId, reveal the actual domain field
    const nonOrgKeys = keys.filter((k) => k !== 'organizationId');
    const field = nonOrgKeys.length > 0 ? nonOrgKeys.join(', ') : (keys[0] || 'record');
    const duplicateVal = nonOrgKeys.length > 0 ? err.keyValue[nonOrgKeys[0]] : err.keyValue?.[keys[0]];

    return res.status(409).json({
      success: false,
      message: `Duplicate entry: A record with this ${field} ("${duplicateVal || ''}") already exists.`,
      field,
      keyValue: err.keyValue,
    });
  }

  // CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid resource identifier: ${err.value}`,
    });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'An unexpected internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
};

module.exports = {
  errorHandler,
};
