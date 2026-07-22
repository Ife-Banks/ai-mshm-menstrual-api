const ort = require('onnxruntime-node');
const { getV8Sessions, getV8Metadata } = require('../loaders/rppgV8ModelLoader');
const {
  extractMoodFeatures,
  buildUnifiedVector,
  fetchV8Sessions,
  PER_TARGET_FEATURES,
  RISK_DOMAIN_FEATURES,
  MOOD_FEATURES,
} = require('./rppgV8FeatureService');

function applyScaler(features, scalerParams) {
  return features.map((val, i) => {
    const m = scalerParams.mean[i] ?? 0;
    const s = scalerParams.scale[i] ?? 1;
    return (val - m) / s;
  });
}

function severityFromScore(score) {
  if (score < 25) return 'Low';
  if (score < 50) return 'Moderate';
  if (score < 75) return 'High';
  return 'Very High';
}

function moodLabel(idx) {
  return ['Low', 'Neutral', 'Positive'][idx] || 'Unknown';
}

async function runONNXInference(session, inputName, features) {
  const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
  const inputFeed = {};
  inputFeed[inputName] = tensor;
  const output = await session.run(inputFeed);
  const keys = Object.keys(output);
  if (!keys.length) return null;
  return output[keys[0]].data;
}

async function predictRegressionAll(vector, target) {
  const sessions = getV8Sessions();
  const meta = getV8Metadata();
  if (!sessions || !meta) return null;

  const feats = PER_TARGET_FEATURES[target];
  if (!feats) return null;

  const scalerData = meta.regression_scalers?.[target];
  if (!scalerData) return null;

  const rawFeatures = feats.map(f => vector[f]);
  const scaled = applyScaler(rawFeatures, scalerData);

  const algos = Object.keys(sessions.regression[target] || {});
  const predictions = {};

  for (const algo of algos) {
    const sess = sessions.regression[target][algo];
    try {
      const inputName = sess.inputNames?.[0] || 'input';
      const data = await runONNXInference(sess, inputName, scaled);
      if (data) {
        predictions[algo] = parseFloat(Number(data[0]).toFixed(2));
      }
    } catch (e) {
      predictions[algo] = null;
    }
  }

  const values = Object.values(predictions).filter(v => v !== null);
  const ensemble = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return {
    target,
    predictions,
    ensemble: ensemble !== null ? parseFloat(ensemble.toFixed(2)) : null,
  };
}

async function predictRiskDomain(vector, domain) {
  const sessions = getV8Sessions();
  const meta = getV8Metadata();
  if (!sessions || !meta) return null;

  const feats = RISK_DOMAIN_FEATURES[domain];
  if (!feats) return null;

  const rawFeatures = feats.map(f => vector[f]);

  const riskScalerData = meta.risk_models?.[domain];
  if (!riskScalerData) return null;

  const scalerData = riskScalerData.scaler || riskScalerData;
  const scaled = applyScaler(rawFeatures, scalerData);

  const regSess = await sessions.risk.loadRegressor(domain);
  const clfSess = sessions.risk.classifiers[domain];

  let riskScore = null;
  let riskProbability = null;

  if (regSess) {
    try {
      const inputName = regSess.inputNames?.[0] || 'input';
      const data = await runONNXInference(regSess, inputName, scaled);
      if (data) riskScore = parseFloat(Number(data[0]).toFixed(2));
    } catch (e) { /* skip */ }
  }

  if (clfSess) {
    try {
      const inputName = clfSess.inputNames?.[0] || 'input';
      const data = await runONNXInference(clfSess, inputName, scaled);
      if (data && data.length >= 2) {
        riskProbability = parseFloat(Number(data[1]).toFixed(4));
      } else if (data) {
        riskProbability = parseFloat(Number(data[0]).toFixed(4));
      }
    } catch (e) { /* skip */ }
  }

  return {
    domain,
    risk_score: riskScore !== null ? Math.min(100, Math.max(0, riskScore)) : null,
    risk_probability: riskProbability,
    risk_flag: riskScore !== null && riskScore >= 50 ? 1 : 0,
    severity: riskScore !== null ? severityFromScore(riskScore) : null,
  };
}

async function predictMoodCheck(vector) {
  const sessions = getV8Sessions();
  const meta = getV8Metadata();
  if (!sessions || !meta) return null;

  const moodMeta = meta.mood_classifier;
  if (!moodMeta) return null;

  const rawFeatures = extractMoodFeatures(vector);
  const scaled = applyScaler(rawFeatures, moodMeta.scaler);

  const algoResults = {};

  for (const [algo, sess] of Object.entries(sessions.mood)) {
    try {
      const inputName = sess.inputNames?.[0] || 'input';
      const tensor = new ort.Tensor('float32', Float32Array.from(scaled), [1, scaled.length]);
      const output = await sess.run({ [inputName]: tensor });

      const probsOut = output['probabilities'];
      if (!probsOut) continue;

      let probs;
      if (probsOut.data) {
        probs = Array.from(probsOut.data).map(Number);
      } else {
        continue;
      }

      const maxIdx = probs.indexOf(Math.max(...probs));
      algoResults[algo] = {
        label: moodLabel(maxIdx),
        confidence: parseFloat(probs[maxIdx].toFixed(4)),
        probabilities: probs.map(v => parseFloat(v.toFixed(4))),
      };
    } catch (e) { /* skip */ }
  }

  const bestAlgo = moodMeta.best_model || Object.keys(algoResults)[0];
  const best = algoResults[bestAlgo] || null;

  return {
    best_prediction: best,
    best_algorithm: bestAlgo,
    all_predictions: algoResults,
    classes: moodMeta.classes || ['Low', 'Neutral', 'Positive'],
  };
}

async function predictAll(userId) {
  const sessionsData = await fetchV8Sessions(userId);
  if (!sessionsData.length) {
    return { error: 'NO_V8_DATA', message: 'No rPPG v8 sessions found for this user.' };
  }

  const last = sessionsData[sessionsData.length - 1];
  const vector = buildUnifiedVector(last);

  const regressionTargets = Object.keys(PER_TARGET_FEATURES);
  const riskDomains = Object.keys(RISK_DOMAIN_FEATURES);

  const regressionResults = {};
  const riskResults = {};

  for (const target of regressionTargets) {
    regressionResults[target] = await predictRegressionAll(vector, target);
  }

  for (const domain of riskDomains) {
    riskResults[domain] = await predictRiskDomain(vector, domain);
  }

  const moodResult = await predictMoodCheck(vector);

  return {
    regression: regressionResults,
    risk: riskResults,
    mood_check: moodResult,
    feature_vector: vector,
    nSessions: sessionsData.length,
  };
}

module.exports = {
  predictRegressionAll,
  predictRiskDomain,
  predictMoodCheck,
  predictAll,
  applyScaler,
};
