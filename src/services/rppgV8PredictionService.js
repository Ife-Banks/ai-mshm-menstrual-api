const ort = require('onnxruntime-node');
const { getV8Sessions, getV8Metadata } = require('../loaders/rppgV8ModelLoader');
const {
  extractFeaturesForTarget,
  extractFeaturesForRiskDomain,
  extractMoodFeatures,
  buildSequenceData,
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
    // TTL in loadRegressor handles eviction after 60s of inactivity
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
        // Normal: plain [1,3] float tensor (MLP, RF, SVM, ExtraTrees, KNN)
        probs = Array.from(probsOut.data).map(Number);
      } else if (Array.isArray(probsOut) || probsOut instanceof Map) {
        // ZipMap: LightGBM returns sequence<map<int64,float>> — keys are BigInt
        const mapObj = Array.isArray(probsOut) ? probsOut[0] : probsOut;
        if (mapObj instanceof Map) {
          probs = [];
          for (const [k, v] of mapObj) probs[Number(k)] = Number(v);
        } else if (typeof mapObj === 'object' && mapObj !== null) {
          probs = [0, 1, 2].map(i => Number(mapObj[i]) || 0);
        } else {
          continue;
        }
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

async function predictDL(target, vector, sessionsData) {
  const sessions = getV8Sessions();
  if (!sessions?.dl?.[target]) return null;

  const dlModels = sessions.dl[target];
  const meta = getV8Metadata();
  const dlMeta = meta.dl_models?.[`${target}_lstm_attn`] || meta.dl_models?.[`${target}_transformer`];

  if (!sessionsData || !sessionsData.length) return null;

  const seqData = buildSequenceData(sessionsData, target);
  if (!seqData) return null;

  const lastIdx = seqData.seq.length - 1;
  const lastSeq = new Float32Array(seqData.seq[lastIdx]);
  const lastMask = new Float32Array(seqData.masks[lastIdx]);

  const results = {};

  for (const [modelType, sess] of Object.entries(dlModels)) {
    try {
      const seqTensor = new ort.Tensor('float32', lastSeq, [1, seqData.seqLen, seqData.nFeat]);
      const maskTensor = new ort.Tensor('float32', lastMask, [1, seqData.seqLen]);
      const output = await sess.run({ seq: seqTensor, mask: maskTensor });
      const keys = Object.keys(output);
      const rawVal = keys.length ? output[keys[0]].data[0] : null;

      if (rawVal !== null && dlMeta) {
        const yMean = dlMeta.y_mean || 0;
        const yStd = dlMeta.y_std || 1;
        const predicted = rawVal * yStd + yMean;
        results[modelType] = parseFloat(predicted.toFixed(2));
      }
    } catch (e) {
      results[modelType] = null;
    }
  }

  const vals = Object.values(results).filter(v => v !== null);
  const ensemble = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  return {
    target,
    predictions: results,
    ensemble: ensemble !== null ? parseFloat(ensemble.toFixed(2)) : null,
    method: 'deep_learning',
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

  const dlResults = {};
  for (const target of ['Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Score']) {
    dlResults[target] = await predictDL(target, vector, sessionsData);
  }

  return {
    regression: regressionResults,
    risk: riskResults,
    mood_check: moodResult,
    deep_learning: dlResults,
    feature_vector: vector,
    nSessions: sessionsData.length,
  };
}

module.exports = {
  predictRegressionAll,
  predictRiskDomain,
  predictMoodCheck,
  predictDL,
  predictAll,
  applyScaler,
};
