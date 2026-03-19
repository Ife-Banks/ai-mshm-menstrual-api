const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

/**
 * @swagger
 * /api/v1/auth/token:
 *   post:
 *     summary: Generate a test JWT token (development only)
 *     description: |
 *       Generates a JWT token for testing the API.
 *       WARNING: This endpoint is for development/testing only.
 *       In production, authentication should be handled by your identity provider.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - client_id
 *               - secret
 *             properties:
 *               client_id:
 *                 type: string
 *                 description: Client identifier
 *                 example: test
 *               secret:
 *                 type: string
 *                 description: Client secret
 *                 example: test
 *           example:
 *             client_id: test
 *             secret: test
 *     responses:
 *       200:
 *         description: Token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: integer
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     expires_in:
 *                       type: integer
 *                 meta:
 *                   type: object
 *             example:
 *               success: true
 *               status: 200
 *               message: Token generated successfully
 *               data:
 *                 token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expires_in: 3600
 *               meta:
 *                 request_id: abc-123
 *                 timestamp: 2026-03-19T12:00:00.000Z
 *                 version: "1.0.0"
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post('/token', (req, res) => {
  const { client_id, secret } = req.body;
  
  if (!client_id || !secret) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'client_id and secret are required',
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  if (!isDevelopment) {
    return res.status(403).json({
      success: false,
      status: 403,
      message: 'Token generation is disabled in production',
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  const payload = {
    sub: client_id,
    client_id,
    iat: Math.floor(Date.now() / 1000)
  };
  
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '1h',
    issuer: process.env.JWT_ISSUER
  });
  
  res.json({
    success: true,
    status: 200,
    message: 'Token generated successfully',
    data: {
      token,
      expires_in: 3600
    },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

module.exports = router;
