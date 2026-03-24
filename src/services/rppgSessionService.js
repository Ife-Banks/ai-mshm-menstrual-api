const prisma = require('../db/prisma');

async function saveRppgSession(userId, sessionPayload) {
  return prisma.rppgSession.create({
    data: {
      userId,
      rmssd: sessionPayload.rmssd,
      meanTemp: sessionPayload.mean_temp,
      meanEda: sessionPayload.mean_eda,
      asi: sessionPayload.asi,
      sessionType: sessionPayload.session_type,
      sessionQuality: sessionPayload.session_quality,
    },
  });
}

async function countRppgSessions(userId) {
  return prisma.rppgSession.count({ where: { userId } });
}

async function getSessionHistory(userId, limit = 30) {
  return prisma.rppgSession.findMany({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
    take: limit,
  });
}

async function getPredictionHistory(userId, limit = 20) {
  return prisma.rppgPredictionResult.findMany({
    where: { userId },
    orderBy: { predictedAt: 'desc' },
    take: limit,
    include: {
      sessions: {
        select: { id: true, capturedAt: true },
      },
    },
  });
}

module.exports = {
  saveRppgSession,
  countRppgSessions,
  getSessionHistory,
  getPredictionHistory,
};
