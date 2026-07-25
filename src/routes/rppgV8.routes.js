const express = require('express');
const Joi = require('joi');
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const { saveV8Session, countV8Sessions, getV8SessionHistory, getV8PredictionHistory, saveV8PredictionResult } = require('../services/rppgV8SessionService');
const { predictAll, predictRegressionAll, predictMoodCheck } = require('../services/rppgV8PredictionService');
const { getV8Sessions, getV8Metadata } = require('../loaders/rppgV8ModelLoader');

const router = express.Router();

const v8SessionSchema = Joi.object({
  rmssd: Joi.number().min(0).max(1000).required(),
  hf: Joi.number().min(0).max(5000).required(),
  lf_hf_ratio: Joi.number().min(0).max(20).required(),
  heart_rate: Joi.number().min(30).max(200).required(),
  hrv: Joi.number().min(0).max(500).required(),
  estimated_spo2: Joi.number().min(80).max(100).required(),
  skin_temperature: Joi.number().min(25).max(42).required(),
  hr_trend: Joi.number().min(-10).max(10).allow(null).default(null),
  mean_eda: Joi.number().min(0).max(20).required(),
  mean_temp: Joi.number().min(25).max(42).required(),
  asi: Joi.number().min(0).max(5).allow(null).default(null),
  rmssd_trend: Joi.number().min(-50).max(50).allow(null).default(null),
  ac: Joi.number().min(0).max(255).allow(null).default(null),
  dc: Joi.number().min(0).max(255).allow(null).default(null),
  ac_dc_ratio: Joi.number().min(0).max(10).allow(null).default(null),
  pulse_amplitude: Joi.number().min(0).max(100).allow(null).default(null),
  signal_quality: Joi.number().min(0).max(100).allow(null).default(null),
  respiratory_rate: Joi.number().min(5).max(40).allow(null).default(null),
  session_type: Joi.string().valid('morning', 'evening', 'baseline', 'checkin').default('checkin'),
  session_quality: Joi.string().valid('good', 'poor', 'motion_artifact').allow(null).default(null),
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
