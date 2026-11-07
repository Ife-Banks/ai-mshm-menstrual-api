const ort = require('onnxruntime-node');
const prisma = require('../db/prisma');
const { getV8Sessions, getV8Metadata } = require('../loaders/rppgV8ModelLoader');
const {
  extractMoodFeatures,
  buildUnifiedVector,
  PER_TARGET_FEATURES,
  MOOD_FEATURES,
} = require('./rppgV8FeatureService');

function applyScaler(features, scalerParams) {
  return features.map((val, i) => {
    const m = scalerParams.mean[i] ?? 0;
    const s = scalerParams.scale[i] ?? 1;
    return (val - m) / s;
  });
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

  const algoResults = await Promise.all(algos.map(async (algo) => {
    const sess = sessions.regression[target][algo];
    try {
      const inputName = sess.inputNames?.[0] || 'input';
      const data = await runONNXInference(sess, inputName, scaled);
      return [algo, data ? parseFloat(Number(data[0]).toFixed(2)) : null];
    } catch (e) {
      return [algo, null];
    }
  }));

  const predictions = Object.fromEntries(algoResults);

  const values = Object.values(predictions).filter(v => v !== null);
  const ensemble = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return {
    target,
    predictions,
    ensemble: ensemble !== null ? parseFloat(ensemble.toFixed(2)) : null,
  };
}

async function predictMoodCheck(vector) {
  const sessions = getV8Sessions();
  const meta = getV8Metadata();
  if (!sessions || !meta) return null;

  const moodMeta = meta.mood_check;
  if (!moodMeta) return null;

  const rawFeatures = extractMoodFeatures(vector);
  const scaled = applyScaler(rawFeatures, moodMeta.scaler);

  const algoEntries = await Promise.all(
    Object.entries(sessions.mood).map(async ([algo, sess]) => {
      try {
        const inputName = sess.inputNames?.[0] || 'input';
        const tensor = new ort.Tensor('float32', Float32Array.from(scaled), [1, scaled.length]);
        const output = await sess.run({ [inputName]: tensor });

        const probsOut = output['probabilities'];
        if (!probsOut || !probsOut.data) return [algo, null];

        const probs = Array.from(probsOut.data).map(Number);
        const maxIdx = probs.indexOf(Math.max(...probs));
        return [algo, {
          label: moodLabel(maxIdx),
          confidence: parseFloat(probs[maxIdx].toFixed(4)),
          probabilities: probs.map(v => parseFloat(v.toFixed(4))),
        }];
      } catch (e) {
        return [algo, null];
      }
    })
  );

  const algoResults = Object.fromEntries(algoEntries.filter(([, v]) => v !== null));

  const bestAlgo = moodMeta.best_model || Object.keys(algoResults)[0];
  const best = algoResults[bestAlgo] || null;

  return {
    best_prediction: best,
    best_algorithm: bestAlgo,
    all_predictions: algoResults,
    classes: moodMeta.classes || ['Low', 'Neutral', 'Positive'],
  };
}

async function timed(label, fn) {
  const start = process.hrtime.bigint();
  try {
    return await (typeof fn === 'function' ? fn() : fn);
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[rppg-v8] ${label}: ${ms.toFixed(0)}ms`);
  }
}

async function predictAll(userId) {
  // Fetch latest session and count in a single query using findFirst with count
  // This reduces Neon DB round-trips by 50% (was 2 queries, now 1)
  const last = await timed('fetchV8Sessions', () =>
    prisma.rppgV8Session.findFirst({
      where: { userId },
      orderBy: { capturedAt: 'desc' },
      include: { _count: { select: { id: true } } },
    })
  );
  
  if (!last) {
    return { error: 'NO_V8_DATA', message: 'No rPPG v8 sessions found for this user.' };
  }
  
  const nSessions = last._count?.id || 0;
  const vector = buildUnifiedVector(last);

  const regressionTargets = Object.keys(PER_TARGET_FEATURES);

  // Regression targets and the mood check are independent — run concurrently
  const [regressionEntries, moodResult] = await timed('inference', () =>
    Promise.all([
      Promise.all(regressionTargets.map(target => predictRegressionAll(vector, target))),
      predictMoodCheck(vector),
    ])
  );
  const regressionResults = {};
  regressionEntries.forEach((entry, i) => {
    if (entry) regressionResults[regressionTargets[i]] = entry;
  });

  return {
    regression: regressionResults,
    mood_check: moodResult,
    feature_vector: vector,
    nSessions,
  };
}

module.exports = {
  predictRegressionAll,
  predictMoodCheck,
  predictAll,
  applyScaler,
};
