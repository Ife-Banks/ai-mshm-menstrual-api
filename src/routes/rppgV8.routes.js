const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const { saveV8Session, countV8Sessions, getV8SessionHistory, getV8PredictionHistory, saveV8PredictionResult } = require('../services/rppgV8SessionService');
const { predictAll, predictRegressionAll, predictRiskDomain, predictMoodCheck } = require('../services/rppgV8PredictionService');
const { getV8Sessions, getV8Metadata } = require('../loaders/rppgV8ModelLoader');

const router = express.Router();

const v8SessionSchema = Joi.object({
  rmssd: Joi.number().min(1).max(1000).required()
    .description('RMSSD in ms (1–1000)'),
  hf: Joi.number().min(0).max(5000).required()
    .description('HF power (ms²)'),
  lf_hf_ratio: Joi.number().min(0).max(20).required()
    .description('LF/HF ratio'),
  heart_rate: Joi.number().min(30).max(200).required()
    .description('Heart rate (bpm)'),
  hrv: Joi.number().min(0).max(500).required()
    .description('Heart rate variability (ms)'),
  estimated_spo2: Joi.number().min(80).max(100).required()
    .description('Estimated SpO2 (%)'),
  skin_temperature: Joi.number().min(25).max(42).required()
    .description('Skin temperature (°C)'),
  hr_trend: Joi.number().min(-10).max(10).allow(null).default(null)
    .description('HR trend slope (bpm/trial)'),
  mean_eda: Joi.number().min(0).max(20).required()
    .description('Mean EDA (µS)'),
  mean_temp: Joi.number().min(25).max(42).required()
    .description('Mean skin temperature (°C)'),
  asi: Joi.number().min(0).max(5).allow(null).default(null)
    .description('Autonomic Stress Index'),
  rmssd_trend: Joi.number().min(-50).max(50).allow(null).default(null)
    .description('RMSSD trend slope (ms/trial)'),
  ac: Joi.number().min(0).max(255).allow(null).default(null)
    .description('AC component'),
  dc: Joi.number().min(0).max(255).allow(null).default(null)
    .description('DC component'),
  ac_dc_ratio: Joi.number().min(0).max(10).allow(null).default(null)
    .description('AC/DC ratio'),
  pulse_amplitude: Joi.number().min(0).max(100).allow(null).default(null)
    .description('Pulse amplitude'),
  signal_quality: Joi.number().min(0).max(100).allow(null).default(null)
    .description('Signal quality (0–1)'),
  respiratory_rate: Joi.number().min(5).max(40).allow(null).default(null)
    .description('Respiratory rate (breaths/min)'),
  session_type: Joi.string()
    .valid('morning', 'evening', 'baseline', 'checkin')
    .default('checkin'),
  session_quality: Joi.string()
    .valid('good', 'poor', 'motion_artifact')
    .allow(null)
    .default(null),
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
        meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
      });
    }
    req.body = value;
    next();
  };
}

function requestMeta(req) {
  return { request_id: req.requestId, timestamp: new Date().toISOString() };
}

router.post('/session', auth, resolveUser, validate(v8SessionSchema), async (req, res, next) => {
  try {
    const saved = await saveV8Session(req.dbUser.id, req.body);
    const totalSessions = await countV8Sessions(req.dbUser.id);
    res.status(201).json({
      success: true,
      status: 201,
      message: 'rPPG v8 session recorded',
      data: { session: saved, session_count: totalSessions },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/predict', auth, resolveUser, async (req, res, next) => {
  try {
    const result = await predictAll(req.dbUser.id);
    if (result.error) {
      return res.status(422).json({
        success: false,
        status: 422,
        message: result.message,
        meta: requestMeta(req),
      });
    }

    await saveV8PredictionResult(req.dbUser.id, result);

    res.json({
      success: true,
      status: 200,
      message: 'rPPG v8 predictions computed',
      data: result,
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/predict/regression', auth, resolveUser, async (req, res, next) => {
  try {
    const { target } = req.body;
    if (!target) {
      return res.status(422).json({ success: false, status: 422, message: 'target is required' });
    }
    const { buildLatestVector } = require('../services/rppgV8FeatureService');
    const vector = await buildLatestVector(req.dbUser.id);
    if (!vector) {
      return res.status(422).json({ success: false, status: 422, message: 'No v8 sessions found' });
    }
    const result = await predictRegressionAll(vector, target);
    res.json({ success: true, status: 200, data: result, meta: requestMeta(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/predict/risk', auth, resolveUser, async (req, res, next) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(422).json({ success: false, status: 422, message: 'domain is required' });
    }
    const { buildLatestVector } = require('../services/rppgV8FeatureService');
    const vector = await buildLatestVector(req.dbUser.id);
    if (!vector) {
      return res.status(422).json({ success: false, status: 422, message: 'No v8 sessions found' });
    }
    const result = await predictRiskDomain(vector, domain);
    res.json({ success: true, status: 200, data: result, meta: requestMeta(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/predict/mood', auth, resolveUser, async (req, res, next) => {
  try {
    const { buildLatestVector } = require('../services/rppgV8FeatureService');
    const vector = await buildLatestVector(req.dbUser.id);
    if (!vector) {
      return res.status(422).json({ success: false, status: 422, message: 'No v8 sessions found' });
    }
    const result = await predictMoodCheck(vector);
    res.json({ success: true, status: 200, data: result, meta: requestMeta(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/sessions', auth, resolveUser, async (req, res, next) => {
  try {
    const sessions = await getV8SessionHistory(req.dbUser.id);
    res.json({
      success: true,
      status: 200,
      message: 'rPPG v8 sessions retrieved',
      data: { sessions, count: sessions.length },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/predictions', auth, resolveUser, async (req, res, next) => {
  try {
    const history = await getV8PredictionHistory(req.dbUser.id);
    res.json({
      success: true,
      status: 200,
      message: 'rPPG v8 prediction history fetched',
      data: { predictions: history, count: history.length },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/metadata', auth, async (req, res, next) => {
  try {
    const meta = getV8Metadata();
    if (!meta) {
      return res.status(503).json({ success: false, status: 503, message: 'v8 models not loaded' });
    }
    res.json({
      success: true,
      status: 200,
      data: {
        version: meta.version,
        all_features: meta.all_features,
        regression_targets: meta.regression_targets,
        risk_domains: meta.risk_domains,
        per_target_features: meta.per_target_features,
        mood_check: meta.mood_check,
      },
      meta: requestMeta(req),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
