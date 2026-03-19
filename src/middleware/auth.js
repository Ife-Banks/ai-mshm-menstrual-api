const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false, status: 401,
      message: 'Missing Authorization header',
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER,
    });
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false, status: 401,
      message: 'Invalid or expired token',
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  }
};
