const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { specs } = require('./swagger/swagger');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({
  origin: [
    'https://ai-mshm-backend.onrender.com',
    'http://localhost:8000',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());

app.use((req, res, next) => {
  req.requestId = require('crypto').randomUUID();
  next();
});

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
});
app.use('/api/', limiter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  customSiteTitle: 'AI-MSHM Menstrual API',
  customCss: '.swagger-ui .topbar { background-color: #1D9E75; }',
  swaggerOptions: {
    url: '/api-docs/swagger.json',
    persistAuthorization: true,
  },
}));

app.get('/api-docs/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'AI-MSHM Menstrual ML API',
    timestamp: new Date().toISOString(),
    models_loaded: true,
  });
});

app.get('/api/v1/health', (req, res) => {
  const { getSessions } = require('./loaders/modelLoader');
  const { getMoodSessions } = require('./loaders/moodModelLoader');
  const menstrualSessions = getSessions();
  const moodSessions = getMoodSessions();
  const modelsLoaded = !!(menstrualSessions && Object.keys(menstrualSessions).length > 0);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    models_loaded: modelsLoaded,
    uptime: parseFloat(process.uptime().toFixed(2)),
  });
});

app.use('/api/v1', routes);
app.use(errorHandler);

module.exports = app;
