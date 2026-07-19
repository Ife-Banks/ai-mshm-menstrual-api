const express = require('express');
const router = express.Router();

const predictionRoutes = require('./prediction.routes');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const moodRoutes = require('./mood.routes');
const rppgRouter = require('./rppg.routes');
const rppgV8Router = require('./rppgV8.routes');

router.use('/menstrual', predictionRoutes);
router.use('/mood', moodRoutes);
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/rppg', rppgRouter);
router.use('/rppg-v8', rppgV8Router);

module.exports = router;
