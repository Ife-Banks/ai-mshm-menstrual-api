require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'ai-mshm-platform',
  modelsDir: process.env.MODELS_DIR || './models/onnx',
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  },
  apiVersion: '1.0.0',
  featureOrder: [
    'CLV',
    'mean_cycle_len',
    'mean_luteal',
    'luteal_std',
    'anovulatory_rate',
    'mean_menses_len',
    'mean_menses_score',
    'unusual_bleed_rate',
    'mean_fertility_days',
    'n_cycles'
  ]
};
