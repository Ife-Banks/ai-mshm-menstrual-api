const express = require('express');
const router = express.Router();
const { getSessionHistory } = require('../services/rppgSessionService');
const prisma = require('../db/prisma');
const { auth, resolveUser, requestMeta } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/dashboard/today-summary:
 *   get:
 *     summary: Get today's dashboard summary data
 *     description: Aggregates today's rPPG session and mood log in a single call
 *     tags: [Dashboard]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Today's summary retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/today-summary', auth, resolveUser, async (req, res, next) => {
  try {
    const userId = req.dbUser.id;

    // Fetch latest rPPG session (limit 1)
    const rppgSessions = await getSessionHistory(userId, 1);
    const latestRppg = rppgSessions.length > 0 ? rppgSessions[0] : null;

    // Fetch latest mood log (limit 1)
    const moodLogs = await prisma.moodDailyLog.findMany({
      where: { userId },
      orderBy: { logDate: 'desc' },
      take: 1,
    });
    const latestMood = moodLogs.length > 0 ? moodLogs[0] : null;

    // Build response
    const summary = {
      rppg: latestRppg ? {
        rmssd: latestRppg.rmssd,
        hrv_rmssd: latestRppg.rmssd,
        mean_temp: latestRppg.meanTemp,
        mean_eda: latestRppg.meanEda,
        asi: latestRppg.asi,
        session_type: latestRppg.sessionType,
        session_quality: latestRppg.sessionQuality,
        captured_at: latestRppg.capturedAt,
      } : null,
      mood: latestMood ? {
        phq4_total: latestMood.phq4Total || latestMood.phq4_total,
        affect_quadrant: latestMood.affectQuadrant || latestMood.affect_quadrant,
        log_date: latestMood.logDate || latestMood.log_date,
      } : null,
    };

    res.json({
      success: true,
      status: 200,
      message: 'Today\'s summary retrieved',
      data: summary,
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
