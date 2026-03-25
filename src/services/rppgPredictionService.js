const ort = require('onnxruntime-node');
const prisma = require('../db/prisma');
const { getRppgSessions, getRppgMetadata } = require('../loaders/rppgModelLoader');

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function getSeverity(score, bins, labels) {
  // Handle missing bins/labels gracefully
  if (!bins || !labels || !bins.length || !labels.length) {
    // Default severity calculation
    if (score < 0.3) return 'Low';
    if (score < 0.6) return 'Medium';
    return 'High';
  }
  
  for (let i = 0; i < bins.length - 1; i++) {
    if (score >= bins[i] && score < bins[i + 1]) {
      return labels[i];
    }
  }
  return labels[labels.length - 1];
}

function applyScaler(featureVector, scalerParams) {
  return featureVector.map((val, i) => {
    const meanVal = scalerParams.mean[i] ?? 0;
    const scaleVal = scalerParams.scale[i] ?? 1;
    return (val - meanVal) / scaleVal;
  });
}

const FIELD_PREFIX = {
  Stress: 'stress',
  CVD: 'cvd',
  T2D: 't2d',
  Metabolic: 'metabolic',
  HeartFailure: 'heartFailure',
  Infertility: 'infertility',
};

async function buildRppgFeatureVector(userId) {
  const sessions = await prisma.rppgSession.findMany({
    where: {
      userId,
      NOT: { sessionQuality: 'motion_artifact' },
    },
    orderBy: { capturedAt: 'asc' },
  });

  if (!sessions.length) {
    const err = new Error('NO_RPPG_DATA');
    err.status = 422;
    err.expose = true;
    throw err;
  }

  const rmssdVals = sessions.map(s => s.rmssd);
  const tempVals = sessions.map(s => s.meanTemp);
  const edaVals = sessions.map(s => s.meanEda);
  const asiVals = sessions.map(s => s.asi).filter(v => v != null);

  const RMSSD_mean = mean(rmssdVals);
  const RMSSD_min = Math.min(...rmssdVals);
  const RMSSD_std = std(rmssdVals);
  const Temp_mean = mean(tempVals);
  const Temp_std = std(tempVals);
  const EDA_mean = mean(edaVals);
  const EDA_max = Math.max(...edaVals);
  const EDA_std = std(edaVals);
  const n_trials = sessions.length;
  const ASI_mean = asiVals.length ? mean(asiVals) : null;

  const clinicalFlags = {
    LowRMSSD_Flag: RMSSD_mean < 20 ? 1 : 0,
    ModLowRMSSD_Flag: RMSSD_mean < 30 ? 1 : 0,
    HighEDA_Flag: EDA_mean > 5.0 ? 1 : 0,
    ElevatedEDA_Flag: EDA_mean > 2.0 ? 1 : 0,
    HighTemp_Flag: Temp_mean > 37.0 ? 1 : 0,
    LowTemp_Flag: Temp_mean < 30.0 ? 1 : 0,
    HighASI_Flag: ASI_mean !== null && ASI_mean > 0.1 ? 1 : 0,
  };

  const featureVector = [
    RMSSD_mean, RMSSD_min, RMSSD_std,
    Temp_mean, Temp_std,
    EDA_mean, EDA_max, EDA_std,
    n_trials,
  ];

  const featureSnapshot = {
    RMSSD_mean,
    RMSSD_min,
    RMSSD_std,
    Temp_mean,
    Temp_std,
    EDA_mean,
    EDA_max,
    EDA_std,
    n_trials,
  };

  return { featureVector, featureSnapshot, clinicalFlags, nSessions: sessions.length, sessions };
}

async function runRppgPredictions(featureVector, diseaseList) {
  const sessions = getRppgSessions();
  const meta = getRppgMetadata();

  if (!sessions || !meta) {
    throw new Error('RPPG_MODELS_NOT_READY');
  }

  const scaled = applyScaler(featureVector, meta.scaler);
  const tensor = new ort.Tensor(
    'float32',
    Float32Array.from(scaled),
    [1, scaled.length]
  );

  const results = {};

  for (const disease of diseaseList) {
    const clf = sessions.classifiers[disease];
    const reg = sessions.regressors[disease];

    if (!clf || !reg) {
      results[disease] = {
        risk_probability: null,
        risk_score: null,
        risk_flag: 0,
        severity: null,
        threshold_used: meta.flag_thresholds?.[disease] ?? null,
      };
      continue;
    }

    const clfOut = Object.values(await clf.run({ float_input: tensor }));
    const regOut = Object.values(await reg.run({ float_input: tensor }));

    const probData = clfOut[0]?.data ?? [];
    const riskProbability = probData.length >= 2
      ? parseFloat(Number(probData[1]).toFixed(4))
      : parseFloat(Number(probData[0] ?? 0).toFixed(4));

    const rawScore = parseFloat(Number(regOut[0]?.data[0] ?? 0).toFixed(4));
    const riskScore = Math.min(1, Math.max(0, rawScore));

    const threshold = meta.flag_thresholds?.[disease] ?? 0.4;
    const riskFlag = riskScore >= threshold ? 1 : 0;
    const severity = getSeverity(riskScore, meta.severity_bins, meta.severity_labels);

    results[disease] = {
      risk_probability: riskProbability,
      risk_score: riskScore,
      risk_flag: riskFlag,
      severity,
      threshold_used: threshold,
    };
  }

  return results;
}

async function runAnomalyDetection(featureVector) {
  const sessions = getRppgSessions();
  const meta = getRppgMetadata();

  if (!meta) {
    throw new Error('RPPG_MODELS_NOT_READY');
  }

  if (sessions?.isolationForest) {
    const scalerParams = meta.scaler_iso || meta.scaler;
    const scaled = applyScaler(featureVector, scalerParams);
    const tensor = new ort.Tensor('float32', Float32Array.from(scaled), [1, scaled.length]);
    const output = Object.values(await sessions.isolationForest.run({ float_input: tensor }));
    const score = parseFloat(Number(output[0]?.data[0] ?? 0).toFixed(4));
    const flag = score < 0 ? 1 : 0;
    return { anomaly_flag: flag, anomaly_score: score, method: 'isolation_forest_onnx' };
  }

  const [RMSSD_mean,,,,, EDA_mean] = featureVector;
  const flag = (RMSSD_mean < 15 && EDA_mean > 8) ? 1 : 0;
  return { anomaly_flag: flag, anomaly_score: null, method: 'rule_based_fallback' };
}

function buildDiseasePayload(predictions) {
  const payload = {};
  for (const [disease, prefix] of Object.entries(FIELD_PREFIX)) {
    const entry = predictions[disease] || {};
    payload[`${prefix}RiskScore`] = entry.risk_score ?? null;
    payload[`${prefix}RiskProb`] = entry.risk_probability ?? null;
    payload[`${prefix}RiskFlag`] = entry.risk_flag ?? null;
    payload[`${prefix}Severity`] = entry.severity ?? null;
  }
  return payload;
}

async function saveRppgPredictionResult({
  userId,
  group,
  featureSnapshot,
  clinicalFlags,
  predictions,
  sessions,
  anomaly,
  nSessions,
}) {
  const diseasePayload = buildDiseasePayload(predictions);
  const sessionConnect = sessions?.length ? sessions.map(s => ({ id: s.id })) : [];

  return prisma.rppgPredictionResult.create({
    data: {
      userId,
      group,
      nSessionsUsed: nSessions,
      rmssdMean: featureSnapshot.RMSSD_mean,
      rmssdMin: featureSnapshot.RMSSD_min,
      rmssdStd: featureSnapshot.RMSSD_std,
      tempMean: featureSnapshot.Temp_mean,
      tempStd: featureSnapshot.Temp_std,
      edaMean: featureSnapshot.EDA_mean,
      edaMax: featureSnapshot.EDA_max,
      edaStd: featureSnapshot.EDA_std,
      lowRmssdFlag: clinicalFlags.LowRMSSD_Flag,
      modLowRmssdFlag: clinicalFlags.ModLowRMSSD_Flag,
      highEdaFlag: clinicalFlags.HighEDA_Flag,
      highAsiFlag: clinicalFlags.HighASI_Flag ?? 0,
      anomalyFlag: anomaly?.anomaly_flag ?? null,
      anomalyScore: anomaly?.anomaly_score ?? null,
      sessions: {
        connect: sessionConnect,
      },
      ...diseasePayload,
    },
  });
}

module.exports = {
  buildRppgFeatureVector,
  runRppgPredictions,
  runAnomalyDetection,
  saveRppgPredictionResult,
  applyScaler,
  DISEASE_FIELD_PREFIX: FIELD_PREFIX,
};
