const prisma = require('../db/prisma');

async function saveV8Session(userId, payload) {
  return prisma.rppgV8Session.create({
    data: {
      userId,
      rmssd: payload.rmssd,
      hf: payload.hf,
      lfHfRatio: payload.lf_hf_ratio,
      heartRate: payload.heart_rate,
      hrv: payload.hrv,
      estimatedSpO2: payload.estimated_spo2,
      skinTemperature: payload.skin_temperature,
      hrTrend: payload.hr_trend,
      meanEda: payload.mean_eda,
      meanTemp: payload.mean_temp,
      asi: payload.asi,
      rmssdTrend: payload.rmssd_trend,
      ac: payload.ac,
      dc: payload.dc,
      acDcRatio: payload.ac_dc_ratio,
      pulseAmplitude: payload.pulse_amplitude,
      signalQuality: payload.signal_quality,
      respiratoryRate: payload.respiratory_rate,
      sessionType: payload.session_type || 'checkin',
      sessionQuality: payload.session_quality,
    },
  });
}

async function countV8Sessions(userId) {
  return prisma.rppgV8Session.count({ where: { userId } });
}

async function getV8SessionHistory(userId, limit = 50) {
  return prisma.rppgV8Session.findMany({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
    take: limit,
  });
}

async function getV8PredictionHistory(userId, limit = 20) {
  return prisma.rppgV8PredictionResult.findMany({
    where: { userId },
    orderBy: { predictedAt: 'desc' },
    take: limit,
  });
}

async function saveV8PredictionResult(userId, predictionData) {
  const { regression, risk, mood_check, deep_learning, nSessions } = predictionData;

  const data = {
    userId,
    nSessionsUsed: nSessions,
    moodCheckLabel: mood_check?.best_prediction?.label || null,
    moodCheckConfidence: mood_check?.best_prediction?.confidence || null,
    moodCheckProbabilities: mood_check?.best_prediction?.probabilities || [],
  };

  for (const [target, result] of Object.entries(regression || {})) {
    const prefix = getTargetPrefix(target);
    if (prefix && result) {
      data[`${prefix}Score`] = result.ensemble;
    }
  }

  for (const [domain, result] of Object.entries(risk || {})) {
    const prefix = getRiskPrefix(domain);
    if (prefix && result) {
      data[`${prefix}RiskScore`] = result.risk_score;
      data[`${prefix}RiskProb`] = result.risk_probability;
      data[`${prefix}RiskFlag`] = result.risk_flag;
      data[`${prefix}Severity`] = result.severity;
    }
  }

  for (const [target, result] of Object.entries(deep_learning || {})) {
    const prefix = getDlPrefix(target);
    if (prefix && result) {
      data[`${prefix}DlScore`] = result.ensemble;
    }
  }

  return prisma.rppgV8PredictionResult.create({ data });
}

function getTargetPrefix(target) {
  const map = {
    Sleep_Quality: 'sleepQuality',
    Focus_Memory: 'focusMemory',
    Mental_Wellness: 'mentalWellness',
    Mood_Score: 'moodScore',
    Metabolic_Syndrome_Risk: 'metabolicSyndrome',
    T2D_Metabolic_Risk_Index: 't2d',
    Cardiovascular_Risk_Score: 'cardiovascular',
    Heart_Failure_Alert_Score: 'heartFailure',
    Chronic_Stress_Severity: 'chronicStress',
    Infertility_Reproductive_Risk: 'infertility',
  };
  return map[target] || null;
}

function getRiskPrefix(domain) {
  const map = {
    Sleep_Quality: 'riskSleepQuality',
    Focus_Memory: 'riskFocusMemory',
    Mental_Wellness: 'riskMentalWellness',
    Mood_Check: 'riskMoodCheck',
    Metabolic_Syndrome: 'riskMetabolic',
    Type_2_Diabetes: 'riskT2d',
    Cardiovascular_Disease: 'riskCvd',
    Heart_Failure: 'riskHeartFailure',
    Chronic_Stress: 'riskChronicStress',
    Infertility: 'riskInfertility',
  };
  return map[domain] || null;
}

function getDlPrefix(target) {
  const map = {
    Sleep_Quality: 'dlSleepQuality',
    Focus_Memory: 'dlFocusMemory',
    Mental_Wellness: 'dlMentalWellness',
    Mood_Score: 'dlMoodScore',
  };
  return map[target] || null;
}

module.exports = {
  saveV8Session,
  countV8Sessions,
  getV8SessionHistory,
  getV8PredictionHistory,
  saveV8PredictionResult,
};
