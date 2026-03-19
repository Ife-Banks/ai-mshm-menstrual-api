const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY_SECONDS = 86400;

function standardEnvelope(res, status, success, message, data = null, extras = {}) {
  res.status(status).json({
    success,
    status,
    message,
    ...(data !== null ? { data } : {}),
    meta: {
      request_id: extras.requestId || require('crypto').randomUUID(),
      timestamp: new Date().toISOString(),
      ...extras.meta,
    },
  });
}

/**
 * @swagger
 * /api/v1/auth/token:
 *   post:
 *     summary: Issue a JWT token for a patient
 *     description: |
 *       Accepts a Django user's UUID as `external_id` and issues a 24-hour JWT.
 *       No authentication required. No database write. Works for any valid UUID string
 *       even if this patient has never been seen before.
 *
 *       **This endpoint is called by the Django backend** on behalf of patients.
 *       The Django backend caches the token in Redis and attaches it as a Bearer
 *       token on every forwarded request.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [external_id]
 *             properties:
 *               external_id:
 *                 type: string
 *                 description: The Django user's UUID
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       200:
 *         description: Token issued successfully
 *       400:
 *         description: external_id is missing or empty
 *       500:
 *         description: Server error
 */
router.post('/token', (req, res) => {
  const { external_id } = req.body || {};
  const requestId = req.requestId || require('crypto').randomUUID();

  if (!external_id || typeof external_id !== 'string' || external_id.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'external_id is required and must be a non-empty string',
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  const payload = {
    external_id: external_id.trim(),
    iat: Math.floor(Date.now() / 1000),
  };

  let token;
  try {
    token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: TOKEN_EXPIRY_SECONDS,
      issuer: process.env.JWT_ISSUER || 'ai-mshm-platform',
    });
  } catch (err) {
    console.error('[Auth] Token signing failed:', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Failed to issue token',
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  res.json({
    success: true,
    status: 200,
    message: 'Token issued successfully',
    data: {
      token,
      expires_in: TOKEN_EXPIRY_SECONDS,
    },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
