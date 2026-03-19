const express = require('express');
const router = express.Router();
const { predict, predictFromLogs, savePredictionResult, computeCriterionFlags, deriveAndAggregate } = require('../services/predictionService');
const { saveCycleLog, getUserCycles, aggregateFromStoredCycles } = require('../services/cycleLogService');
const { aggregatedSchema, cycleLogsSchema, cycleEntrySchema, validate } = require('../middleware/validate');
const auth = require('../middleware/auth');
const resolveUser = require('../middleware/resolveUser');
const prisma = require('../db/prisma');

/**
 * @swagger
 * /api/v1/menstrual/log-cycle:
 *   post:
 *     summary: Log a single menstrual cycle
 *     description: |
 *       Called by the mobile app at the end of each period.
 *       Stores the cycle in the database and returns the updated
 *       aggregate statistics across all cycles for this user.
 *       Use this BEFORE calling /predict — the prediction endpoint
 *       will read from stored cycles automatically.
 *     tags: [Cycles]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [period_start_date, period_end_date, bleeding_scores, has_ovulation_peak, unusual_bleeding]
 *             properties:
 *               period_start_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-03-04"
 *               period_end_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-03-09"
 *               bleeding_scores:
 *                 type: array
 *                 items:
 *                   type: integer
 *                   minimum: 1
 *                   maximum: 4
 *                 example: [2, 3, 3, 2, 1]
 *               has_ovulation_peak:
 *                 type: boolean
 *                 example: true
 *               unusual_bleeding:
 *                 type: boolean
 *                 example: false
 *               rppg_ovulation_day:
 *                 type: integer
 *                 nullable: true
 *                 example: null
 *     responses:
 *       201:
 *         description: Cycle logged successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 */
router.post('/log-cycle', auth, resolveUser, validate(cycleEntrySchema), async (req, res, next) => {
  try {
    const { rppg_ovulation_day, ...cycleData } = req.body;
    const saved = await saveCycleLog(req.dbUser.id, cycleData, rppg_ovulation_day ?? null);

    const allCycles   = await getUserCycles(req.dbUser.id);
    const aggregated  = aggregateFromStoredCycles(allCycles);
    const criterionFlags = computeCriterionFlags(aggregated, allCycles);

    return res.status(201).json({
      success: true,
      status: 201,
      message: 'Cycle logged successfully',
      data: {
        cycle: saved,
        updated_aggregates: aggregated,
        total_cycles_stored: allCycles.length,
        criterion_flags: {
          criterion_1_positive: criterionFlags.criterion_1_positive,
          criteria: criterionFlags.criteria,
          summary: criterionFlags.summary,
        },
      },
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/menstrual/predict:
 *   post:
 *     summary: Predict disease risk from stored cycle history
 *     description: |
 *       Fetches all stored cycles for the authenticated user from the database,
 *       aggregates them into model features, runs inference, and saves the result.
 *       
 *       **Recommended flow:**
 *       1. Call POST /log-cycle for each completed period
 *       2. Call this endpoint to get predictions using ALL stored cycles
 *       
 *       ⚠️ For batch submission without DB storage, use POST /predict/from-logs
 *     tags: [Prediction]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Prediction completed successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: No cycles logged yet
 *       500:
 *         description: Internal server error
 */
router.post('/predict', auth, resolveUser, async (req, res, next) => {
  try {
    const allCycles = await getUserCycles(req.dbUser.id);

    if (allCycles.length === 0) {
      return res.status(422).json({
        success: false, status: 422,
        message: 'No cycles logged yet. Use POST /log-cycle first.',
        meta: {
          request_id: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const features = aggregateFromStoredCycles(allCycles);
    const result = await predict(features);
    const criterionFlags = computeCriterionFlags(features, allCycles);

    await savePredictionResult(
      req.dbUser.id,
      features,
      result.predictions,
      'from-db',
      criterionFlags
    );

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Prediction completed successfully',
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
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/menstrual/predict/from-logs:
 *   post:
 *     summary: Predict disease risk from raw user-logged cycle data (stateless)
 *     description: |
 *       Accepts raw per-cycle logs as the user provides them in the app.
 *       The server derives all 10 model features internally before running inference.
 *       Does NOT store cycles in the database — use POST /log-cycle for storage.
 *
 *       **User logs (4 fields per cycle):**
 *       - `period_start_date` — date picker
 *       - `period_end_date` — date picker
 *       - `bleeding_scores` — daily intensity array (1=Spotting, 2=Light, 3=Medium, 4=Heavy)
 *       - `has_ovulation_peak` — boolean from BBT/rPPG
 *       - `unusual_bleeding` — boolean from daily log
 *     tags: [Prediction]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cycles]
 *             properties:
 *               cycles:
 *                 type: array
 *                 minItems: 1
 *                 description: Array of per-cycle log objects
 *                 items:
 *                   type: object
 *                   required: [period_start_date, period_end_date, bleeding_scores, has_ovulation_peak, unusual_bleeding]
 *                   properties:
 *                     period_start_date:
 *                       type: string
 *                       format: date
 *                       example: "2025-01-05"
 *                     period_end_date:
 *                       type: string
 *                       format: date
 *                       example: "2025-01-10"
 *                     bleeding_scores:
 *                       type: array
 *                       items:
 *                         type: integer
 *                         minimum: 1
 *                         maximum: 4
 *                       example: [2, 3, 3, 2, 1]
 *                     has_ovulation_peak:
 *                       type: boolean
 *                       example: true
 *                     unusual_bleeding:
 *                       type: boolean
 *                       example: false
 *               rppg_ovulation_day:
 *                 type: integer
 *                 nullable: true
 *                 example: null
 *           example:
 *             cycles:
 *               - period_start_date: "2025-01-05"
 *                 period_end_date: "2025-01-10"
 *                 bleeding_scores: [2, 3, 3, 2, 1]
 *                 has_ovulation_peak: true
 *                 unusual_bleeding: false
 *               - period_start_date: "2025-02-03"
 *                 period_end_date: "2025-02-08"
 *                 bleeding_scores: [1, 2, 4, 3, 2, 1]
 *                 has_ovulation_peak: true
 *                 unusual_bleeding: false
 *             rppg_ovulation_day: null
 *     responses:
 *       200:
 *         description: Prediction completed successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */
router.post('/predict/from-logs', auth, validate(cycleLogsSchema), async (req, res, next) => {
  try {
    const { cycles, rppg_ovulation_day } = req.body;
    const result = await predictFromLogs(cycles, rppg_ovulation_day);

    const { predictions, features_used, model_module, derived_features, warnings, criterion_1_positive, criteria, summary } = result;

    res.json({
      success: true,
      status: 200,
      message: 'Prediction completed successfully',
      data: {
        predictions,
        derived_features,
        features_used,
        model_module,
        warnings,
        criterion_flags: {
          criterion_1_positive,
          criteria,
          summary,
        },
      },
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/menstrual/history:
 *   get:
 *     summary: Get all cycle logs for this user
 *     description: Returns all stored menstrual cycles for the authenticated user
 *     tags: [Cycles]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cycle history retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/history', auth, resolveUser, async (req, res, next) => {
  try {
    const cycles = await getUserCycles(req.dbUser.id);
    const aggregated = cycles.length > 0 ? aggregateFromStoredCycles(cycles) : null;
    const criterionFlags = cycles.length > 0 ? computeCriterionFlags(aggregated, cycles) : null;
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Cycle history retrieved',
      data: {
        cycles,
        total: cycles.length,
        aggregates: aggregated,
        criterion_flags: criterionFlags
          ? { criterion_1_positive: criterionFlags.criterion_1_positive, criteria: criterionFlags.criteria, summary: criterionFlags.summary }
          : null,
      },
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/menstrual/predictions:
 *   get:
 *     summary: Get prediction history for this user
 *     description: Returns the last 20 prediction results stored for the authenticated user
 *     tags: [Prediction]
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
    const predictions = await prisma.predictionResult.findMany({
      where: { userId: req.dbUser.id },
      orderBy: { predictedAt: 'desc' },
      take: 20,
    });
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Prediction history retrieved',
      data: { predictions, total: predictions.length },
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v1/menstrual/features:
 *   get:
 *     summary: Get feature schema and descriptions
 *     description: Returns the feature schema with descriptions for all 10 model input features
 *     tags: [Information]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Feature schema retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/features', auth, (req, res) => {
  const features = [
    { name: 'CLV', description: 'Cycle Length Variability — std dev of cycle lengths (days). Use 0 if < 3 cycles logged.', type: 'number', range: '0 to ∞' },
    { name: 'mean_cycle_len', description: 'Mean cycle length in days across all logged cycles.', type: 'number', range: '10 to 90' },
    { name: 'mean_luteal', description: 'Mean luteal phase length in days. Use 14 if unknown.', type: 'number', range: '0 to 30' },
    { name: 'luteal_std', description: 'Std dev of luteal phase length. Use 0 if < 3 cycles.', type: 'number', range: '0 to ∞' },
    { name: 'anovulatory_rate', description: 'Fraction of cycles with no detected ovulation peak (0–1). 0 = always ovulated.', type: 'number', range: '0 to 1' },
    { name: 'mean_menses_len', description: 'Mean menstrual bleeding length in days.', type: 'number', range: '0 to 14' },
    { name: 'mean_menses_score', description: 'Mean total menses score — cumulative daily bleeding score (Spotting=1, Light=2, Medium=3, Heavy=4) summed per period.', type: 'number', range: '0 to 24' },
    { name: 'unusual_bleed_rate', description: 'Fraction of cycles with unusual/intermenstrual bleeding flagged (0–1).', type: 'number', range: '0 to 1' },
    { name: 'mean_fertility_days', description: 'Mean number of fertile window days per cycle.', type: 'number', range: '0 to 30' },
    { name: 'n_cycles', description: 'Total number of cycles logged by this client.', type: 'integer', range: '1 to ∞' }
  ];
  
  res.json({
    success: true,
    status: 200,
    message: 'Feature schema retrieved successfully',
    data: { features },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

/**
 * @swagger
 * /api/v1/menstrual/model-info:
 *   get:
 *     summary: Get model metadata, diseases, and metrics
 *     description: Returns model information including diseases, flag thresholds, severity bins, and model metrics
 *     tags: [Information]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Model info retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/model-info', auth, (req, res) => {
  const { getMetadata } = require('../loaders/modelLoader');
  const meta = getMetadata();
  
  if (!meta) {
    return res.status(503).json({
      success: false,
      status: 503,
      message: 'Models not yet loaded',
      meta: {
        request_id: req.requestId,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  const diseases = meta.diseases.map(name => ({
    name,
    flag_threshold: meta.flag_thresholds[name]
  }));
  
  res.json({
    success: true,
    status: 200,
    message: 'Model info retrieved successfully',
    data: {
      diseases,
      severity_bins: meta.severity_bins,
      severity_labels: meta.severity_labels,
      model_metrics: meta.model_metrics,
      trained_at: meta.trained_at,
      module: meta.module
    },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

module.exports = router;
