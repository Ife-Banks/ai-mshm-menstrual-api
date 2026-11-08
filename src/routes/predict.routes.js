const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const prisma = require('../db/prisma');

const { getUserCycles, aggregateFromStoredCycles } = require('../services/cycleLogService');
const { predict, savePredictionResult, computeCriterionFlags } = require('../services/predictionService');
const {
  buildFeatureVector: buildMoodFeatureVector,
  runDiseasePredictions,
  saveMoodPrediction,
  saveMoodPredictionsBatch,
} = require('../services/moodPredictionService');
const {
  buildRppgFeatureVector,
  runRppgPredictions,
  saveRppgPredictionResult,
  saveRppgPredictionsBatch,
  buildPredictionResponse,
  MIN_REQUIREMENTS,
} = require('../services/rppgPredictionService');
const { predictAll: predictV8All } = require('../services/rppgV8PredictionService');
const { saveV8PredictionResult } = require('../services/rppgV8SessionService');

const RPPG_GROUPS = {
  metabolic_cardio: ['CVD', 'T2D', 'Metabolic', 'HeartFailure'],
  stress_reproductive: ['Stress', 'Infertility'],
};

const MOOD_GROUPS = {
  mental_health: ['Anxiety', 'Depression', 'PMDD', 'ChronicStress'],
  metabolic: ['T2D_Mood', 'MetSyn_Mood'],
  cardio_neuro: ['CVD_Mood', 'Stroke_Mood'],
  reproductive: ['Infertility_Mood'],
};

function groupError(err) {
  console.error('[predict-all] group failed:', err);
  return {
    success: false,
    status: err.status || 500,
    message: err.message || 'Prediction failed',
  };
}

// Per-user batch cache — keyed by userId only (requestId is unique per call
// and made the previous cache useless). Entries expire after 30s.
const BATCH_CACHE_TTL_MS = 30000;
const batchCache = new Map();

function getBatchCache(key) {
  const entry = batchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= BATCH_CACHE_TTL_MS) {
    batchCache.delete(key);
    return null;
  }
  return entry.response;
}

function setBatchCache(key, response) {
  if (batchCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of batchCache) {
      if (now - v.timestamp >= BATCH_CACHE_TTL_MS) batchCache.delete(k);
    }
  }
  batchCache.set(key, { timestamp: Date.now(), response });
}

async function timed(label, fn) {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[predict-all] ${label}: ${ms.toFixed(0)}ms`);
  }
}

function moodFindHighestRisk(predictions) {
  let highest = { disease: null, score: -1 };
  for (const [disease, result] of Object.entries(predictions)) {
    if (result.risk_score > highest.score) {
      highest = { disease, score: result.risk_score };
    }
  }
  return highest.disease;
}

function moodAnyFlagRaised(predictions) {
  return Object.values(predictions).some(r => r.risk_flag === 1);
}

async function runMenstrualGroup(userId) {
  const allCycles = await getUserCycles(userId);
  if (allCycles.length === 0) {
    return { success: false, status: 422, message: 'No cycles logged yet.' };
  }

  const features = aggregateFromStoredCycles(allCycles);
  const result = await predict(features);
  const criterionFlags = computeCriterionFlags(features, allCycles);

  await savePredictionResult(userId, features, result.predictions, 'from-db', criterionFlags);

  return {
    success: true,
    data: {
      predictions: result.predictions,
      derived_features: features,
      cycles_used: allCycles.length,
      model_module: result.model_module,
      criterion_flags: {
        criterion_1_positive: criterionFlags.criterion_1_positive,
        criteria: criterionFlags.criteria,
        summary: criterionFlags.summary,
      },
    },
  };
}

async function runRppgGroup(userId, group, vectorData, requestId) {
  const { featureVector, featureSnapshot, clinicalFlags, nSessions, sessions } = vectorData;
  const diseases = RPPG_GROUPS[group];

  let predictions = await runRppgPredictions(featureVector, diseases);

  // Override CVD/Metabolic if RMSSD is not declining (same as /predict/metabolic-cardio)
  if (group === 'metabolic_cardio' && clinicalFlags.RMSSD_Declining_Flag !== 1) {
    const trendWarning = 'Prediction overridden: RMSSD is not showing a declining trend over the measurement period. CVD/Metabolic risk requires a sustained HRV decline.';
    for (const disease of ['CVD', 'Metabolic']) {
      if (predictions[disease]) {
        predictions[disease].risk_score_overridden = true;
        predictions[disease].risk_score = null;
        predictions[disease].risk_flag = 0;
        predictions[disease].severity = 'Insufficient';
        predictions[disease].insufficient_trend_data = true;
        predictions[disease].warning = trendWarning;
      }
    }
  }

  // Don't save here - will be batched in runRppgAll

  const payload = buildPredictionResponse({
    message: `${group} rPPG risk scores computed`,
    group,
    diseases,
    featureSnapshot,
    clinicalFlags,
    predictions,
    sessionsUsed: nSessions,
    requestId,
  });

  return { success: true, data: payload.data, _predictions: predictions };
}

async function runRppgAll(userId, requestId) {
  // Both groups share the same minimum requirements — build the vector once
  const reqs = MIN_REQUIREMENTS.metabolic_cardio;
  const vectorData = await timed('rppg.feature_vector', () =>
    buildRppgFeatureVector(userId, reqs.minSessions, reqs.minSpanDays)
  );

  const [metabolicCardio, stressReproductive] = await timed('rppg.groups', () =>
    Promise.all([
      runRppgGroup(userId, 'metabolic_cardio', vectorData, requestId),
      runRppgGroup(userId, 'stress_reproductive', vectorData, requestId),
    ])
  );

  // Batch save both groups in one DB operation
  const { featureSnapshot, clinicalFlags, nSessions, sessions } = vectorData;
  const groupPredictions = {};
  if (metabolicCardio._predictions) {
    groupPredictions.metabolic_cardio = metabolicCardio._predictions;
  }
  if (stressReproductive._predictions) {
    groupPredictions.stress_reproductive = stressReproductive._predictions;
  }
  
  await timed('rppg.save_batch', () => 
    saveRppgPredictionsBatch(userId, groupPredictions, featureSnapshot, clinicalFlags, sessions, nSessions)
  );

  // Remove internal _predictions field from response
  const cleanMetabolic = { ...metabolicCardio };
  const cleanStress = { ...stressReproductive };
  delete cleanMetabolic._predictions;
  delete cleanStress._predictions;

  return {
    metabolic_cardio: cleanMetabolic,
    stress_reproductive: cleanStress,
  };
}

async function runV8Group(userId) {
  const result = await timed('rppg_v8.predictAll', () => predictV8All(userId));
  if (result.error) {
    return { success: false, status: 422, message: result.message };
  }
  await timed('rppg_v8.save', () => saveV8PredictionResult(userId, result));
  return { success: true, data: result };
}

async function runMoodGroup(userId, group, featureVector, logsCount) {
  const diseases = MOOD_GROUPS[group];
  const predictions = await runDiseasePredictions(featureVector, diseases);
  await saveMoodPrediction(userId, group, predictions, logsCount);

  return {
    success: true,
    data: {
      group,
      diseases_assessed: diseases,
      logs_used: logsCount,
      highest_risk: moodFindHighestRisk(predictions),
      any_flag_raised: moodAnyFlagRaised(predictions),
      predictions,
    },
  };
}

async function runMoodAll(userId) {
  // Count and feature-vector build are independent — fetch in parallel
  const [logsCount, featureVector] = await timed('mood.prep', () =>
    Promise.all([
      prisma.moodDailyLog.count({ where: { userId } }),
      buildMoodFeatureVector(userId),
    ])
  );

  // Run all mood groups concurrently
  const entries = await timed('mood.groups', () =>
    Promise.all(
      Object.keys(MOOD_GROUPS).map(group =>
        (async () => {
          const diseases = MOOD_GROUPS[group];
          const predictions = await runDiseasePredictions(featureVector, diseases);
          return {
            success: true,
            data: {
              group,
              diseases_assessed: diseases,
              logs_used: logsCount,
              highest_risk: moodFindHighestRisk(predictions),
              any_flag_raised: moodAnyFlagRaised(predictions),
              predictions,
            },
            _predictions: predictions, // For batch save
          };
        })().catch(groupError)
      )
    )
  );

  // Batch save all mood predictions in one DB operation
  const groupPredictions = {};
  entries.forEach((entry, i) => {
    if (entry && entry.success && entry._predictions) {
      const groupName = Object.keys(MOOD_GROUPS)[i];
      groupPredictions[groupName] = { predictions: entry._predictions };
    }
  });
  
  await timed('mood.save_batch', () => saveMoodPredictionsBatch(userId, groupPredictions, logsCount));

  // Remove internal _predictions field from response
  const cleanEntries = entries.map(entry => {
    if (entry && entry._predictions) {
      const { _predictions, ...rest } = entry;
      return rest;
    }
    return entry;
  });

  return {
    mental_health: cleanEntries[0],
    metabolic: cleanEntries[1],
    cardio_neuro: cleanEntries[2],
    reproductive: cleanEntries[3],
  };
}

/**
 * @swagger
 * /api/v1/predict/all:
 *   post:
 *     summary: Run all disease predictions in one batched call
 *     description: |
 *       Runs the menstrual, rPPG (HRV), rPPG v8 (camera), and mood model
 *       families in parallel and returns every group's predictions in a
 *       single response. Each group reports its own success/data or error so
 *       one unavailable data source does not fail the whole batch.
 *     tags: [Prediction]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Batched predictions computed (per-group status inside data)
 *       401:
 *         description: Unauthorized
 */
router.post('/all', auth, resolveUser, async (req, res, next) => {
  try {
    const userId = req.dbUser.id;
    const requestId = req.requestId;

    // Groups the caller asked to skip (e.g. Django skips menstrual for male
    // users — the model has no valid male meaning).
    const rawSkip = req.body?.skip ?? req.query?.skip;
    const skip = new Set(
      (Array.isArray(rawSkip) ? rawSkip : rawSkip ? [rawSkip] : [])
        .flatMap(s => String(s).split(','))
        .map(s => s.trim())
        .filter(Boolean)
    );

    const cacheKey = `batch-${userId}`;
    const cached = getBatchCache(cacheKey);
    if (cached) {
      console.log(`[predict-all] Returning cached result for ${userId}`);
      return res.json(cached);
    }

    const batchStart = process.hrtime.bigint();
    const skipped = (name) =>
      Promise.resolve({ success: false, status: 200, message: `Skipped: ${name}`, skipped: true });
    const [menstrual, rppg, rppg_v8, mood] = await Promise.all([
      skip.has('menstrual') ? skipped('menstrual') : timed('menstrual', () => runMenstrualGroup(userId)).catch(groupError),
      timed('rppg', () => runRppgAll(userId, requestId)).catch(groupError),
      skip.has('rppg_v8') ? skipped('rppg_v8') : timed('rppg_v8', () => runV8Group(userId)).catch(groupError),
      skip.has('mood') ? skipped('mood') : timed('mood', () => runMoodAll(userId)).catch(groupError),
    ]);
    const batchMs = Number(process.hrtime.bigint() - batchStart) / 1e6;
    console.log(`[predict-all] TOTAL: ${batchMs.toFixed(0)}ms`);

    const response = {
      success: true,
      status: 200,
      message: 'All predictions computed',
      data: {
        menstrual,
        rppg,
        rppg_v8,
        mood,
      },
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    // Cache the result for 30 seconds
    setBatchCache(cacheKey, response);

    res.json(response);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
