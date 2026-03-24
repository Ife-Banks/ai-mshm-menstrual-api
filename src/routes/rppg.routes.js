const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const {
  saveRppgSession,
  countRppgSessions,
  getSessionHistory,
  getPredictionHistory,
} = require('../services/rppgSessionService');
const {
  buildRppgFeatureVector,
  runRppgPredictions,
  runAnomalyDetection,
  saveRppgPredictionResult,
  DISEASE_FIELD_PREFIX,
} = require('../services/rppgPredictionService');

const router = express.Router();

const DISEASE_GROUPS = {
  metabolic_cardio: ['CVD', 'T2D', 'Metabolic', 'HeartFailure'],
  stress_reproductive: ['Stress', 'Infertility'],
};

const rppgSessionSchema = Joi.object({
  rmssd: Joi.number().min(5).max(300).required()
    .description('RMSSD in milliseconds (5–300). Low values (<20ms) indicate chronic stress.'),
  mean_temp: Joi.number().min(25).max(42).required()
    .description('Mean skin temperature in °C (25–42).'),
  mean_eda: Joi.number().min(0).max(20).required()
    .description('Mean electrodermal activity in µS (0–20).'),
  asi: Joi.number().min(0).max(2).allow(null).default(null)
    .description('Autonomic Stress Index (0–1.58). Optional.'),
  session_type: Joi.string()
    .valid('morning', 'evening', 'baseline', 'checkin')
    .default('checkin')
    .description('Type of check-in session.'),
  session_quality: Joi.string()
    .valid('good', 'poor', 'motion_artifact')
    .allow(null)
    .default(null)
    .description('Signal quality flag from the device.'),
});

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(422).json({
        success: false,
        status: 422,
        message: 'Validation failed',
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
        meta: {
          request_id: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
    req.body = value;
    next();
  };
}

function buildPredictionResponse({
  message,
  group,
  diseases,
  featureSnapshot,
  clinicalFlags,
  predictions,
  sessionsUsed,
  requestId,
}) {
  const anyFlag = Object.values(predictions).some(d => d.risk_flag === 1);
  return {
    success: true,
    status: 200,
    message,
    data: {
      group,
      diseases_assessed: diseases,
      sessions_used: sessionsUsed,
      any_flag_raised: anyFlag,
      feature_snapshot: featureSnapshot,
      clinical_flags: clinicalFlags,
      predictions,
    },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

function mapPredictionRecord(record) {
  const predictions = {};
  for (const [disease, prefix] of Object.entries(DISEASE_FIELD_PREFIX)) {
    predictions[disease] = {
      risk_score: record[`${prefix}RiskScore`],
      risk_probability: record[`${prefix}RiskProb`],
      risk_flag: record[`${prefix}RiskFlag`],
      severity: record[`${prefix}Severity`],
    };
  }

  return {
    id: record.id,
    group: record.group,
    predicted_at: record.predictedAt,
    sessions_used: record.nSessionsUsed,
    anomaly_flag: record.anomalyFlag,
    anomaly_score: record.anomalyScore,
    feature_snapshot: {
      RMSSD_mean: record.rmssdMean,
      RMSSD_min: record.rmssdMin,
      RMSSD_std: record.rmssdStd,
      Temp_mean: record.tempMean,
      Temp_std: record.tempStd,
      EDA_mean: record.edaMean,
      EDA_max: record.edaMax,
      EDA_std: record.edaStd,
      n_trials: record.nSessionsUsed,
    },
    clinical_flags: {
      LowRMSSD_Flag: record.lowRmssdFlag,
      ModLowRMSSD_Flag: record.modLowRmssdFlag,
      HighEDA_Flag: record.highEdaFlag,
      HighASI_Flag: record.highAsiFlag,
    },
    sessions: record.sessions,
    predictions,
  };
}

function requestMeta(req) {
  return {
    request_id: req.requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * @swagger
 * /api/v1/rppg/session:
 *   post:
 *     summary: Submit a passive rPPG session
 *     description: Store one rPPG sensor session captured by the front-facing camera.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RppgSessionInput'
 *     responses:
 *       201:
 *         description: Session saved
 *       422:
 *         description: Validation failed
 */
router.post('/session', auth, resolveUser, validate(rppgSessionSchema), async (req, res, next) => {
  try {
    const saved = await saveRppgSession(req.dbUser.id, req.body);
    const totalSessions = await countRppgSessions(req.dbUser.id);
    res.status(201).json({
      success: true,
      status: 201,
      message: 'rPPG session recorded',
      data: {
        session: saved,
        session_count: totalSessions,
      },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/rppg/predict/metabolic-cardio:
 *   post:
 *     summary: Predict metabolic & cardiovascular risk
 *     description: Aggregates stored rPPG sessions and runs CVD, T2D, Metabolic, and Heart Failure models.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Metabolic & cardiovascular risk scores
 *       422:
 *         description: Not enough rPPG data
 */
router.post('/predict/metabolic-cardio', auth, resolveUser, async (req, res, next) => {
  try {
    const {
      featureVector,
      featureSnapshot,
      clinicalFlags,
      nSessions,
      sessions,
    } = await buildRppgFeatureVector(req.dbUser.id);

    const predictions = await runRppgPredictions(featureVector, DISEASE_GROUPS.metabolic_cardio);

    await saveRppgPredictionResult({
      userId: req.dbUser.id,
      group: 'metabolic_cardio',
      featureSnapshot,
      clinicalFlags,
      predictions,
      sessions,
      nSessions,
    });

    const payload = buildPredictionResponse({
      message: 'Metabolic & cardiovascular rPPG risk scores computed',
      group: 'metabolic_cardio',
      diseases: DISEASE_GROUPS.metabolic_cardio,
      featureSnapshot,
      clinicalFlags,
      predictions,
      sessionsUsed: nSessions,
      requestId: req.requestId,
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/rppg/predict/stress-reproductive:
 *   post:
 *     summary: Predict stress & reproductive risk
 *     description: Aggregates rPPG sessions and runs Stress and Infertility models.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Stress & reproductive risk scores
 *       422:
 *         description: Not enough rPPG data
 */
router.post('/predict/stress-reproductive', auth, resolveUser, async (req, res, next) => {
  try {
    const {
      featureVector,
      featureSnapshot,
      clinicalFlags,
      nSessions,
      sessions,
    } = await buildRppgFeatureVector(req.dbUser.id);

    const predictions = await runRppgPredictions(featureVector, DISEASE_GROUPS.stress_reproductive);

    await saveRppgPredictionResult({
      userId: req.dbUser.id,
      group: 'stress_reproductive',
      featureSnapshot,
      clinicalFlags,
      predictions,
      sessions,
      nSessions,
    });

    const payload = buildPredictionResponse({
      message: 'Stress & reproductive rPPG risk scores computed',
      group: 'stress_reproductive',
      diseases: DISEASE_GROUPS.stress_reproductive,
      featureSnapshot,
      clinicalFlags,
      predictions,
      sessionsUsed: nSessions,
      requestId: req.requestId,
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/rppg/predict/anomaly:
 *   post:
 *     summary: Run biometric anomaly detection
 *     description: Uses IsolationForest (or a rule-based fallback) to flag extreme autonomic shifts.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Anomaly flag and interpretation
 *       422:
 *         description: Not enough rPPG data
 */
router.post('/predict/anomaly', auth, resolveUser, async (req, res, next) => {
  try {
    const {
      featureVector,
      featureSnapshot,
      clinicalFlags,
      nSessions,
      sessions,
    } = await buildRppgFeatureVector(req.dbUser.id);

    const anomalyResult = await runAnomalyDetection(featureVector);

    await saveRppgPredictionResult({
      userId: req.dbUser.id,
      group: 'anomaly',
      featureSnapshot,
      clinicalFlags,
      predictions: {},
      sessions,
      nSessions,
      anomaly: anomalyResult,
    });

    const interpretation = anomalyResult.anomaly_flag
      ? 'Biometric pattern flagged as anomalous — consistent with PCOS autonomic signature.'
      : 'Biometric pattern within expected range for now.';

    res.json({
      success: true,
      status: 200,
      message: 'rPPG anomaly score computed',
      data: {
        group: 'anomaly',
        sessions_used: nSessions,
        anomaly_flag: anomalyResult.anomaly_flag,
        anomaly_score: anomalyResult.anomaly_score,
        method: anomalyResult.method,
        clinical_flags: {
          LowRMSSD_Flag: clinicalFlags.LowRMSSD_Flag,
          HighEDA_Flag: clinicalFlags.HighEDA_Flag,
        },
        interpretation,
      },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/rppg/sessions:
 *   get:
 *     summary: List recent rPPG sessions
 *     description: Returns the last 30 signed sessions, including signal quality flags.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Session history
 */
router.get('/sessions', auth, resolveUser, async (req, res, next) => {
  try {
    const sessions = await getSessionHistory(req.dbUser.id);
    res.json({
      success: true,
      status: 200,
      message: 'rPPG sessions retrieved',
      data: {
        sessions,
        count: sessions.length,
      },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/rppg/predictions:
 *   get:
 *     summary: rPPG prediction history
 *     description: Lists the most recent 20 rPPG group predictions, including anomaly flags.
 *     tags: [rPPG / HRV]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Prediction results
 */
router.get('/predictions', auth, resolveUser, async (req, res, next) => {
  try {
    const history = await getPredictionHistory(req.dbUser.id);
    const payload = history.map(mapPredictionRecord);
    res.json({
      success: true,
      status: 200,
      message: 'rPPG prediction history fetched',
      data: {
        predictions: payload,
        count: payload.length,
      },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
