const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the API service
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: Service is healthy
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: healthy
 *                     uptime:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                 meta:
 *                   type: object
 *             example:
 *               success: true
 *               status: 200
 *               message: Service is healthy
 *               data:
 *                 status: healthy
 *                 uptime: 3600.5
 *                 timestamp: 2026-03-19T12:00:00.000Z
 *               meta:
 *                 request_id: abc-123
 *                 timestamp: 2026-03-19T12:00:00.000Z
 *                 version: "1.0.0"
 */
router.get('/health', (req, res) => {
  const startTime = process.uptime();
  
  res.json({
    success: true,
    status: 200,
    message: 'Service is healthy',
    data: {
      status: 'healthy',
      uptime: parseFloat(startTime.toFixed(2)),
      timestamp: new Date().toISOString()
    },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

module.exports = router;
