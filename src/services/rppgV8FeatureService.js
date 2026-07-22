const prisma = require('../db/prisma');

const ALL_FEATURES = [
  'RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV',
  'Estimated_SpO2', 'Skin_Temperature', 'HR_Trend', 'Mean_EDA', 'Mean_Temp',
  'Autonomic_Stress_Index', 'RMSSD_Trend',
];

const PER_TARGET_FEATURES = {
  Sleep_Quality:           ['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Estimated_SpO2', 'Skin_Temperature'],
  Focus_Memory:            ['RMSSD', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV'],
  Mental_Wellness:         ['RMSSD', 'LF_HF_Ratio', 'HF', 'Heart_Rate'],
  Mood_Score:              ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'],
  Metabolic_Syndrome_Risk: ['RMSSD', 'Mean_EDA', 'Mean_Temp'],
  T2D_Metabolic_Risk_Index:['Mean_Temp', 'RMSSD'],
  Cardiovascular_Risk_Score: ['RMSSD', 'Mean_EDA'],
  Heart_Failure_Alert_Score:['RMSSD_Trend', 'Mean_Temp'],
  Chronic_Stress_Severity: ['Mean_EDA', 'RMSSD'],
  Infertility_Reproductive_Risk:['Autonomic_Stress_Index', 'RMSSD', 'Mean_EDA'],
};

const RISK_DOMAIN_FEATURES = {
  Sleep_Quality:           ['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Estimated_SpO2', 'Skin_Temperature'],
  Focus_Memory:            ['RMSSD', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV'],
  Mental_Wellness:         ['RMSSD', 'LF_HF_Ratio', 'HF', 'Heart_Rate'],
  Mood_Check:              ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'],
  Metabolic_Syndrome:      ['RMSSD', 'Mean_EDA', 'Mean_Temp'],
  Type_2_Diabetes:         ['Mean_Temp', 'RMSSD'],
  Cardiovascular_Disease:  ['RMSSD', 'Mean_EDA'],
  Heart_Failure:           ['RMSSD_Trend', 'Mean_Temp'],
  Chronic_Stress:          ['Mean_EDA', 'RMSSD'],
  Infertility:             ['Autonomic_Stress_Index', 'RMSSD', 'Mean_EDA'],
};

const MOOD_FEATURES = ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'];

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function linregSlope(xs, ys) {
  if (xs.length < 2) return 0;
  const xm = mean(xs), ym = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xm;
    num += dx * (ys[i] - ym);
    den += dx * dx;
  }
  return den !== 0 ? num / den : 0;
}

function computeHRVStatus(rmssd) {
  if (rmssd >= 50) return 'Normal/Excellent';
  if (rmssd >= 40) return 'Slightly Reduced';
  if (rmssd >= 30) return 'Moderately Reduced';
  if (rmssd >= 20) return 'Low';
  if (rmssd >= 10) return 'Very Low';
  return 'Extremely Low';
}

async function fetchV8Sessions(userId) {
  const sessions = await prisma.rppgV8Session.findMany({
    where: { userId },
    orderBy: { capturedAt: 'asc' },
  });
  return sessions;
}

function buildUnifiedVector(session) {
  const vec = {};
  vec['RMSSD'] = session.rmssd;
  vec['HF'] = session.hf;
  vec['LF_HF_Ratio'] = session.lfHfRatio;
  vec['Heart_Rate'] = session.heartRate;
  vec['Heart_Rate_Variability_HRV'] = session.hrv;
  vec['Estimated_SpO2'] = session.estimatedSpO2;
  vec['Skin_Temperature'] = session.skinTemperature;
  vec['HR_Trend'] = session.hrTrend;
  vec['Mean_EDA'] = session.meanEda;
  vec['Mean_Temp'] = session.meanTemp;
  vec['Autonomic_Stress_Index'] = session.asi;
  vec['RMSSD_Trend'] = session.rmssdTrend;
  return vec;
}

function extractFeaturesForTarget(unifiedVec, targetName) {
  const feats = PER_TARGET_FEATURES[targetName];
  if (!feats) return null;
  return feats.map(f => unifiedVec[f]);
}

function extractFeaturesForRiskDomain(unifiedVec, domain) {
  const feats = RISK_DOMAIN_FEATURES[domain];
  if (!feats) return null;
  return feats.map(f => unifiedVec[f]);
}

function extractMoodFeatures(unifiedVec) {
  return MOOD_FEATURES.map(f => unifiedVec[f]);
}

async function buildLatestVector(userId) {
  const sessions = await fetchV8Sessions(userId);
  if (!sessions.length) return null;
  return buildUnifiedVector(sessions[sessions.length - 1]);
}

async function buildAggregatedVector(userId) {
  const sessions = await fetchV8Sessions(userId);
  if (!sessions.length) return null;

  const n = sessions.length;
  const last = sessions[n - 1];
  const first = sessions[0];

  const rmssdVals = sessions.map(s => s.rmssd);
  const edaVals = sessions.map(s => s.meanEda);
  const tempVals = sessions.map(s => s.meanTemp);
  const asiVals = sessions.map(s => s.asi).filter(v => v != null);
  const hrVals = sessions.map(s => s.heartRate);
  const hfVals = sessions.map(s => s.hf).filter(v => v != null);
  const lfHfVals = sessions.map(s => s.lfHfRatio).filter(v => v != null);
  const spo2Vals = sessions.map(s => s.estimatedSpO2).filter(v => v != null);
  const hrvVals = sessions.map(s => s.hrv).filter(v => v != null);

  const daysSinceFirst = (new Date(last.capturedAt) - new Date(first.capturedAt)) / (1000 * 60 * 60 * 24);
  const trialIndices = sessions.map((_, i) => i);
  const hrTrend = linregSlope(trialIndices, hrVals);
  const rmssdTrend = linregSlope(trialIndices, rmssdVals);

  const vec = {};
  vec['RMSSD'] = mean(rmssdVals);
  vec['HF'] = hfVals.length ? mean(hfVals) : 0;
  vec['LF_HF_Ratio'] = lfHfVals.length ? mean(lfHfVals) : 0;
  vec['Heart_Rate'] = hrVals.length ? mean(hrVals) : 0;
  vec['Heart_Rate_Variability_HRV'] = hrvVals.length ? mean(hrvVals) : 0;
  vec['Estimated_SpO2'] = spo2Vals.length ? mean(spo2Vals) : 0;
  vec['Skin_Temperature'] = last.skinTemperature || 0;
  vec['HR_Trend'] = hrTrend;
  vec['Mean_EDA'] = mean(edaVals);
  vec['Mean_Temp'] = mean(tempVals);
  vec['Autonomic_Stress_Index'] = asiVals.length ? mean(asiVals) : 0;
  vec['RMSSD_Trend'] = rmssdTrend;

  return {
    vector: vec,
    sessions,
    daysSpan: Math.round(daysSinceFirst * 10) / 10,
    nSessions: n,
    rmssdStatus: computeHRVStatus(vec['RMSSD']),
    clinicalFlags: {
      LowRMSSD_Flag: vec['RMSSD'] < 20 ? 1 : 0,
      HighEDA_Flag: vec['Mean_EDA'] > 5.0 ? 1 : 0,
      HighTemp_Flag: vec['Mean_Temp'] > 37.0 ? 1 : 0,
      HighASI_Flag: vec['Autonomic_Stress_Index'] > 0.5 ? 1 : 0,
      RMSSD_Declining_Flag: rmssdTrend < -0.05 ? 1 : 0,
    },
  };
}

module.exports = {
  ALL_FEATURES,
  PER_TARGET_FEATURES,
  RISK_DOMAIN_FEATURES,
  MOOD_FEATURES,
  fetchV8Sessions,
  buildUnifiedVector,
  extractFeaturesForTarget,
  extractFeaturesForRiskDomain,
  extractMoodFeatures,
  buildLatestVector,
  buildAggregatedVector,
  computeHRVStatus,
};
