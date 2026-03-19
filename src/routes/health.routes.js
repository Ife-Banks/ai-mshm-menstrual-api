const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check / liveness probe
 *     description: |
 *       Returns the health status of the API service. No authentication required.
 *       The Django proxy utility calls this before attempting token exchange.
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
 *                       example: ok
 *                     models_loaded:
 *                       type: boolean
 *                       example: true
 *                     uptime:
 *                       type: number
 *                       example: 123.45
 *                     timestamp:
 *                       type: string
 *                       example: "2026-03-19T12:00:00.000Z"
 *                 meta:
 *                   type: object
 *             example:
 *               success: true
 *               status: 200
 *               message: Service is healthy
 *               data:
 *                 status: ok
 *                 models_loaded: true
 *                 uptime: 123.45
 *                 timestamp: "2026-03-19T12:00:00.000Z"
 *               meta:
 *                 request_id: abc-123
 *                 timestamp: "2026-03-19T12:00:00.000Z"
 */
router.get('/health', (req, res) => {
  const { getSessions } = require('../loaders/modelLoader');
  const { getMoodSessions } = require('../loaders/moodModelLoader');

  const menstrualSessions = getSessions();
  const moodSessions = getMoodSessions();
  const modelsLoaded = !!(menstrualSessions && Object.keys(menstrualSessions).length > 0);

  res.json({
    success: true,
    status: 200,
    message: 'Service is healthy',
    data: {
      status: 'ok',
      models_loaded: modelsLoaded,
      uptime: parseFloat(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString(),
    },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
