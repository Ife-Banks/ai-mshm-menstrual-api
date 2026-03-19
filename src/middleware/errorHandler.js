function errorHandler(err, req, res, next) {
  console.error('[ErrorHandler]', err.stack);

  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'Internal server error';

  res.status(status).json({
    success: false,
    status,
    message,
    errors: err.details || undefined,
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = errorHandler;
