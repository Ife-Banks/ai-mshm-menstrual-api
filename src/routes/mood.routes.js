const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const { saveMoodLog, getUserLogs, getAllUserLogs } = require('../services/moodLogService');
const { buildFeatureVector, runDiseasePredictions, saveMoodPrediction } = require('../services/moodPredictionService');
const prisma = require('../db/prisma');
const Joi = require('joi');

const DISEASE_GROUPS = {
  mental_health: ['Anxiety', 'Depression', 'PMDD', 'ChronicStress'],
  metabolic: ['T2D_Mood', 'MetSyn_Mood'],
  cardio_neuro: ['CVD_Mood', 'Stroke_Mood'],
  reproductive: ['Infertility_Mood']
};

async function triggerMoodPredictions(userId) {
  const logs = await getAllUserLogs(userId);
  if (logs.length < 3) return;

  try {
    const featureVector = await buildFeatureVector(userId);
    await Promise.allSettled([
      (async () => {
        const p = await runDiseasePredictions(featureVector, DISEASE_GROUPS.mental_health);
        await saveMoodPrediction(userId, 'mental_health', p, logs.length);
      })(),
      (async () => {
        const p = await runDiseasePredictions(featureVector, DISEASE_GROUPS.metabolic);
        await saveMoodPrediction(userId, 'metabolic', p, logs.length);
      })(),
      (async () => {
        const p = await runDiseasePredictions(featureVector, DISEASE_GROUPS.cardio_neuro);
        await saveMoodPrediction(userId, 'cardio_neuro', p, logs.length);
      })(),
      (async () => {
        const p = await runDiseasePredictions(featureVector, DISEASE_GROUPS.reproductive);
        await saveMoodPrediction(userId, 'reproductive', p, logs.length);
      })(),
    ]);
  } catch (err) {
    console.warn('[Mood] Prediction trigger failed:', err.message);
  }
}

const schemas = {
  phq4: Joi.object({
    phq4_item1: Joi.number().integer().min(0).max(3).required()
      .description('GAD-2 Q1: Feeling nervous/anxious/on edge (0=Not at all, 3=Nearly every day)'),
    phq4_item2: Joi.number().integer().min(0).max(3).required()
      .description('GAD-2 Q2: Unable to stop/control worrying'),
    phq4_item3: Joi.number().integer().min(0).max(3).required()
      .description('PHQ-2 Q3: Little interest or pleasure in doing things'),
    phq4_item4: Joi.number().integer().min(0).max(3).required()
      .description('PHQ-2 Q4: Feeling down, depressed, or hopeless'),
    log_date: Joi.string().isoDate().optional()
      .description('ISO date string (YYYY-MM-DD) for the log date. Defaults to today if omitted.'),
  }),
  affect: Joi.object({
    affect_valence: Joi.number().integer().min(1).max(10).required()
      .description('How positive do you feel? 1=Very negative, 10=Very positive'),
    affect_arousal: Joi.number().integer().min(1).max(10).required()
      .description('How energised do you feel? 1=Calm/sleepy, 10=Excited/alert'),
    log_date: Joi.string().isoDate().optional()
      .description('ISO date string (YYYY-MM-DD). Defaults to today if omitted.'),
  }),
  focus: Joi.object({
    focus_score: Joi.number().integer().min(1).max(10).required()
      .description('How well were you able to concentrate? 1=Very scattered, 10=Laser-focused'),
    memory_score: Joi.number().integer().min(1).max(10).required()
      .description('How well were you able to remember things? 1=Very forgetful, 10=Sharp recall'),
    mental_fatigue: Joi.number().integer().min(1).max(10).required()
      .description('How mentally drained do you feel? 1=Completely drained, 10=Mentally fresh'),
    log_date: Joi.string().isoDate().optional()
      .description('ISO date string (YYYY-MM-DD). Defaults to today if omitted.'),
  }),
  sleep: Joi.object({
    sleep_quality: Joi.number().integer().min(1).max(10).required()
      .description('How restful was your sleep? 1=Very poor, 10=Excellent'),
    hours_slept: Joi.number().min(0).max(12).required()
      .description('Total hours slept (0-12)'),
    log_date: Joi.string().isoDate().optional()
      .description('ISO date string (YYYY-MM-DD). Defaults to today if omitted.'),
  }),
  complete: Joi.object({
    phq4_item1: Joi.number().integer().min(0).max(3).required(),
    phq4_item2: Joi.number().integer().min(0).max(3).required(),
    phq4_item3: Joi.number().integer().min(0).max(3).required(),
    phq4_item4: Joi.number().integer().min(0).max(3).required(),
    affect_valence: Joi.number().integer().min(1).max(10).required(),
    affect_arousal: Joi.number().integer().min(1).max(10).required(),
    focus_score: Joi.number().integer().min(1).max(10).required(),
    memory_score: Joi.number().integer().min(1).max(10).required(),
    mental_fatigue: Joi.number().integer().min(1).max(10).required(),
    sleep_quality: Joi.number().integer().min(1).max(10).required(),
    hours_slept: Joi.number().min(0).max(12).required(),
    cycle_phase: Joi.string().valid('Menstrual', 'Follicular', 'Ovulatory', 'Luteal').allow(null).optional()
      .description('Current cycle phase — enables phase-specific PMDD analysis'),
    log_date: Joi.string().isoDate().optional()
      .description('ISO date string (YYYY-MM-DD). Defaults to today if omitted.'),
  }),
};

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(422).json({
        success: false, status: 422,
        message: 'Validation failed',
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
        meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
      });
    }
    req.body = value;
    next();
  };
}

function findHighestRisk(predictions) {
  let highest = { disease: null, score: -1 };
  for (const [disease, result] of Object.entries(predictions)) {
    if (result.risk_score > highest.score) {
      highest = { disease, score: result.risk_score };
    }
  }
  return highest.disease;
}

function anyFlagRaised(predictions) {
  return Object.values(predictions).some(r => r.risk_flag === 1);
}

async function getOrCreateDailyLog(userId, logDate) {
  const dateStr = logDate || new Date().toISOString().split('T')[0];
  let entry = await prisma.moodDailyLog.findFirst({
    where: { userId, logDate: new Date(dateStr) },
  });
  if (!entry) {
    entry = await prisma.moodDailyLog.create({
      data: { userId, logDate: new Date(dateStr) },
    });
  }
  return entry;
}

/**
 * @swagger
 * /api/v1/mood/log/phq4:
 *   post:
 *     summary: Log Mental Wellness (PHQ-4)
 *     description: |
 *       Submit the PHQ-4 (Patient Health Questionnaire-4) screen.
 *       Can be called independently — data is merged into the user's daily log for the given date.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PHQ4Log'
 *           example:
 *             phq4_item1: 1
 *             phq4_item2: 2
 *             phq4_item3: 1
 *             phq4_item4: 0
 *             log_date: "2026-03-19"
 *     responses:
 *       200:
 *         description: PHQ-4 logged successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log/phq4', auth, resolveUser, validate(schemas.phq4), async (req, res, next) => {
  try {
    const entry = await getOrCreateDailyLog(req.dbUser.id, req.body.log_date);
    const anxiety = req.body.phq4_item1 + req.body.phq4_item2;
    const depression = req.body.phq4_item3 + req.body.phq4_item4;
    
    await prisma.moodDailyLog.update({
      where: { id: entry.id },
      data: {
        phq4Item1: req.body.phq4_item1,
        phq4Item2: req.body.phq4_item2,
        phq4Item3: req.body.phq4_item3,
        phq4Item4: req.body.phq4_item4,
        phq4AnxietyScore: anxiety,
        phq4DepressionScore: depression,
        phq4Total: anxiety + depression,
        phq4AnxietyFlag: anxiety >= 3 ? 1 : 0,
        phq4DepressionFlag: depression >= 3 ? 1 : 0,
      },
    });

    res.json({
      success: true, status: 200,
      message: 'PHQ-4 logged successfully',
      data: { phq4_anxiety_score: anxiety, phq4_depression_score: depression, phq4_total: anxiety + depression, log_date: entry.logDate },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
    triggerMoodPredictions(req.dbUser.id);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/log/affect:
 *   post:
 *     summary: Log Mood Check (Affect Grid)
 *     description: |
 *       Submit the Affect Grid screen — valence (positivity) and arousal (energy) ratings.
 *       Can be called independently — data is merged into the user's daily log for the given date.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AffectLog'
 *           example:
 *             affect_valence: 2
 *             affect_arousal: 2
 *             log_date: "2026-03-19"
 *     responses:
 *       200:
 *         description: Affect logged successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log/affect', auth, resolveUser, validate(schemas.affect), async (req, res, next) => {
  try {
    const entry = await getOrCreateDailyLog(req.dbUser.id, req.body.log_date);
    const { affect_valence: val, affect_arousal: aro } = req.body;

    let quadrant;
    if (val === 5 && aro === 5) {
      quadrant = 'Neutral';
    } else if (val >= 6 && aro >= 6) {
      quadrant = 'Happy-Energised';
    } else if (val >= 6 && aro <= 5) {
      quadrant = 'Calm-Relaxed';
    } else if (val <= 5 && aro >= 6) {
      quadrant = 'Anxious-Agitated';
    } else {
      quadrant = 'Depressed-Fatigued';
    }

    await prisma.moodDailyLog.update({
      where: { id: entry.id },
      data: { affectValence: val, affectArousal: aro, affectQuadrant: quadrant },
    });

    res.json({
      success: true, status: 200,
      message: 'Affect logged successfully',
      data: { affect_valence: val, affect_arousal: aro, affect_quadrant: quadrant, log_date: entry.logDate },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
    triggerMoodPredictions(req.dbUser.id);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/log/focus:
 *   post:
 *     summary: Log Focus & Memory
 *     description: |
 *       Submit the Focus & Memory screen — focus, memory, and mental fatigue ratings.
 *       Can be called independently — data is merged into the user's daily log for the given date.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FocusLog'
 *           example:
 *             focus_score: 7
 *             memory_score: 6
 *             mental_fatigue: 4
 *             log_date: "2026-03-19"
 *     responses:
 *       200:
 *         description: Focus & memory logged successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log/focus', auth, resolveUser, validate(schemas.focus), async (req, res, next) => {
  try {
    const entry = await getOrCreateDailyLog(req.dbUser.id, req.body.log_date);
    const cogRaw = (req.body.focus_score + req.body.memory_score + req.body.mental_fatigue) / 3;
    const cognitiveLoadScore = parseFloat((((cogRaw / 10) * 4 + 1)).toFixed(4));

    await prisma.moodDailyLog.update({
      where: { id: entry.id },
      data: {
        focusScore: req.body.focus_score,
        memoryScore: req.body.memory_score,
        mentalFatigue: req.body.mental_fatigue,
        cognitiveLoadScore,
      },
    });

    res.json({
      success: true, status: 200,
      message: 'Focus & memory logged successfully',
      data: { cognitive_load_score: cognitiveLoadScore, log_date: entry.logDate },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
    triggerMoodPredictions(req.dbUser.id);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/log/sleep:
 *   post:
 *     summary: Log Sleep Quality
 *     description: |
 *       Submit the Sleep Quality screen — sleep quality rating and hours slept.
 *       Can be called independently — data is merged into the user's daily log for the given date.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SleepLog'
 *           example:
 *             sleep_quality: 7
 *             hours_slept: 7.5
 *             log_date: "2026-03-19"
 *     responses:
 *       200:
 *         description: Sleep logged successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log/sleep', auth, resolveUser, validate(schemas.sleep), async (req, res, next) => {
  try {
    const entry = await getOrCreateDailyLog(req.dbUser.id, req.body.log_date);
    const sleepSatisfaction = parseFloat((((req.body.sleep_quality / 10) * 4 + 1)).toFixed(4));

    await prisma.moodDailyLog.update({
      where: { id: entry.id },
      data: {
        sleepQuality: req.body.sleep_quality,
        hoursSlept: req.body.hours_slept,
        sleepSatisfaction,
      },
    });

    res.json({
      success: true, status: 200,
      message: 'Sleep logged successfully',
      data: { sleep_satisfaction: sleepSatisfaction, hours_slept: req.body.hours_slept, log_date: entry.logDate },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
    triggerMoodPredictions(req.dbUser.id);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/log/complete:
 *   post:
 *     summary: Log all 4 screens at once
 *     description: |
 *       Submit all 4 mood/cognitive screens in a single request.
 *       All fields are required — use individual endpoints if submitting screens independently.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CompleteMoodLog'
 *           example:
 *             phq4_item1: 1
 *             phq4_item2: 2
 *             phq4_item3: 1
 *             phq4_item4: 0
 *             affect_valence: 2
 *             affect_arousal: 2
 *             focus_score: 7
 *             memory_score: 6
 *             mental_fatigue: 4
 *             sleep_quality: 7
 *             hours_slept: 7.5
 *             cycle_phase: "Luteal"
 *             log_date: "2026-03-19"
 *     responses:
 *       200:
 *         description: Complete daily log saved
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log/complete', auth, resolveUser, validate(schemas.complete), async (req, res, next) => {
  try {
    const { phq4_item1, phq4_item2, phq4_item3, phq4_item4, affect_valence, affect_arousal, focus_score, memory_score, mental_fatigue, sleep_quality, hours_slept, cycle_phase, log_date } = req.body;
    
    const entry = await getOrCreateDailyLog(req.dbUser.id, log_date);
    const anxiety = phq4_item1 + phq4_item2;
    const depression = phq4_item3 + phq4_item4;
    const cogRaw = (focus_score + memory_score + mental_fatigue) / 3;
    const cognitiveLoadScore = parseFloat((((cogRaw / 10) * 4 + 1)).toFixed(4));
    const sleepSatisfaction = parseFloat((((sleep_quality / 10) * 4 + 1)).toFixed(4));
    const PHQ4_MAX = 12.0, COG_MAX = 5.0, SLEEP_MAX = 5.0;
    const phq4Norm = (anxiety + depression) / PHQ4_MAX;
    const cogDef = (COG_MAX - cognitiveLoadScore) / (COG_MAX - 1);
    const sleepDef = (SLEEP_MAX - sleepSatisfaction) / (SLEEP_MAX - 1);
    const psychBurdenScore = parseFloat(Math.min(10, Math.max(0, (phq4Norm * 0.40 + cogDef * 0.35 + sleepDef * 0.25) * 10)).toFixed(4));
    let quadrant;
    if (affect_valence === 5 && affect_arousal === 5) {
      quadrant = 'Neutral';
    } else if (affect_valence >= 6 && affect_arousal >= 6) {
      quadrant = 'Happy-Energised';
    } else if (affect_valence >= 6 && affect_arousal <= 5) {
      quadrant = 'Calm-Relaxed';
    } else if (affect_valence <= 5 && affect_arousal >= 6) {
      quadrant = 'Anxious-Agitated';
    } else {
      quadrant = 'Depressed-Fatigued';
    }

    await prisma.moodDailyLog.update({
      where: { id: entry.id },
      data: {
        phq4Item1, phq4Item2, phq4Item3, phq4Item4,
        phq4AnxietyScore: anxiety, phq4DepressionScore: depression,
        phq4Total: anxiety + depression,
        phq4AnxietyFlag: anxiety >= 3 ? 1 : 0,
        phq4DepressionFlag: depression >= 3 ? 1 : 0,
        affectValence: affect_valence, affectArousal: affect_arousal, affectQuadrant: quadrant,
        focusScore: focus_score, memoryScore: memory_score, mentalFatigue: mental_fatigue,
        cognitiveLoadScore, sleepQuality: sleep_quality, hoursSlept, sleepSatisfaction,
        psychBurdenScore, cyclePhase: cycle_phase || null,
      },
    });

    res.json({
      success: true, status: 200,
      message: 'Complete daily log saved',
      data: { phq4_total: anxiety + depression, affect_quadrant: quadrant, cognitive_load_score: cognitiveLoadScore, sleep_satisfaction: sleepSatisfaction, psych_burden_score: psychBurdenScore, log_date: entry.logDate },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
    triggerMoodPredictions(req.dbUser.id);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/history:
 *   get:
 *     summary: Get mood log history
 *     description: Returns the last 30 daily mood logs for the authenticated user, ordered by date descending.
 *     tags: [Mood Logging]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Mood history retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/history', auth, resolveUser, async (req, res, next) => {
  try {
    const logs = await prisma.moodDailyLog.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { logDate: 'desc' },
      take: 30,
    });
    res.json({
      success: true, status: 200,
      message: 'Mood history retrieved',
      data: { logs, total: logs.length },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/predict/mental-health:
 *   post:
 *     summary: Predict mental health risks
 *     tags: [Mood Prediction]
 *     security:
 *       - BearerAuth: []
 */
router.post('/predict/mental-health', auth, resolveUser, async (req, res, next) => {
  try {
    const logs = await prisma.moodDailyLog.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { logDate: 'asc' },
    });
    if (logs.length < 3) {
      return res.status(422).json({
        success: false, status: 422,
        message: 'Minimum 3 daily logs required',
        errors: [{ field: 'logs', message: `Only ${logs.length} logs found.` }],
        meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
      });
    }
    const featureVector = await buildFeatureVector(req.dbUser.id);
    const predictions = await runDiseasePredictions(featureVector, DISEASE_GROUPS.mental_health);
    await saveMoodPrediction(req.dbUser.id, 'mental_health', predictions, logs.length);

    let response = {
      group: 'mental_health',
      diseases_assessed: DISEASE_GROUPS.mental_health,
      logs_used: logs.length,
      highest_risk: findHighestRisk(predictions),
      any_flag_raised: anyFlagRaised(predictions),
      predictions,
    };
    if (predictions.Depression?.risk_flag === 1) {
      response.critical_flag = true;
      response.critical_message = 'Depression risk flag raised — clinical review recommended';
    }

    res.json({
      success: true, status: 200,
      message: 'Mental health risk scores computed',
      data: response,
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/predict/metabolic:
 *   post:
 *     summary: Predict metabolic risks
 *     tags: [Mood Prediction]
 *     security:
 *       - BearerAuth: []
 */
router.post('/predict/metabolic', auth, resolveUser, async (req, res, next) => {
  try {
    const logs = await prisma.moodDailyLog.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { logDate: 'asc' },
    });
    if (logs.length < 3) {
      return res.status(422).json({ success: false, status: 422, message: 'Minimum 3 logs required', meta: { request_id: req.requestId, timestamp: new Date().toISOString() } });
    }
    const featureVector = await buildFeatureVector(req.dbUser.id);
    const predictions = await runDiseasePredictions(featureVector, DISEASE_GROUPS.metabolic);
    await saveMoodPrediction(req.dbUser.id, 'metabolic', predictions, logs.length);

    res.json({
      success: true, status: 200,
      message: 'Metabolic risk scores computed',
      data: { group: 'metabolic', diseases_assessed: DISEASE_GROUPS.metabolic, logs_used: logs.length, highest_risk: findHighestRisk(predictions), any_flag_raised: anyFlagRaised(predictions), predictions },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/predict/cardio-neuro:
 *   post:
 *     summary: Predict cardiovascular risks
 *     tags: [Mood Prediction]
 *     security:
 *       - BearerAuth: []
 */
router.post('/predict/cardio-neuro', auth, resolveUser, async (req, res, next) => {
  try {
    const logs = await prisma.moodDailyLog.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { logDate: 'asc' },
    });
    if (logs.length < 3) {
      return res.status(422).json({ success: false, status: 422, message: 'Minimum 3 logs required', meta: { request_id: req.requestId, timestamp: new Date().toISOString() } });
    }
    const featureVector = await buildFeatureVector(req.dbUser.id);
    const predictions = await runDiseasePredictions(featureVector, DISEASE_GROUPS.cardio_neuro);
    await saveMoodPrediction(req.dbUser.id, 'cardio_neuro', predictions, logs.length);

    res.json({
      success: true, status: 200,
      message: 'Cardio-neuro risk scores computed',
      data: { group: 'cardio_neuro', diseases_assessed: DISEASE_GROUPS.cardio_neuro, logs_used: logs.length, highest_risk: findHighestRisk(predictions), any_flag_raised: anyFlagRaised(predictions), predictions },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/predict/reproductive:
 *   post:
 *     summary: Predict reproductive risks
 *     tags: [Mood Prediction]
 *     security:
 *       - BearerAuth: []
 */
router.post('/predict/reproductive', auth, resolveUser, async (req, res, next) => {
  try {
    const logs = await prisma.moodDailyLog.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { logDate: 'asc' },
    });
    if (logs.length < 3) {
      return res.status(422).json({ success: false, status: 422, message: 'Minimum 3 logs required', meta: { request_id: req.requestId, timestamp: new Date().toISOString() } });
    }
    const featureVector = await buildFeatureVector(req.dbUser.id);
    const predictions = await runDiseasePredictions(featureVector, DISEASE_GROUPS.reproductive);
    await saveMoodPrediction(req.dbUser.id, 'reproductive', predictions, logs.length);

    res.json({
      success: true, status: 200,
      message: 'Reproductive risk scores computed',
      data: { group: 'reproductive', diseases_assessed: DISEASE_GROUPS.reproductive, logs_used: logs.length, highest_risk: findHighestRisk(predictions), any_flag_raised: anyFlagRaised(predictions), predictions },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/mood/predictions:
 *   get:
 *     summary: Get mood prediction history
 *     description: Returns the last 20 mood prediction results for the authenticated user.
 *     tags: [Mood Prediction]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Prediction history retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/predictions', auth, resolveUser, async (req, res, next) => {
  try {
    const predictions = await prisma.moodPredictionResult.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { predictedAt: 'desc' },
      take: 20,
    });
    res.json({
      success: true, status: 200,
      message: 'Prediction history retrieved',
      data: { predictions, total: predictions.length },
      meta: { request_id: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

module.exports = router;
