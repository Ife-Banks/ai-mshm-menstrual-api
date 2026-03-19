const swaggerJsdoc = require('swagger-jsdoc');

const description = [
  '## Overview',
  'Unified API for predicting health risks based on menstrual cycle and mood/cognitive data.',
  'This API is called exclusively by the Django backend (`https://ai-mshm-backend.onrender.com`) on behalf of patients. It is not called directly by the mobile or web frontend.',
  '',
  '## Menstrual Cycle Endpoints',
  '| Group | Diseases | Endpoint |',
  '|---|---|---|---|',
  '| Cycle | Log cycle | POST /api/v1/menstrual/log-cycle |',
  '| Cycle | Get history | GET /api/v1/menstrual/history |',
  '| Prediction | All 6 diseases | POST /api/v1/menstrual/predict |',
  '',
  '## Mood & Cognitive Endpoints',
  '| Group | Screen | Endpoint |',
  '|---|---|---|---|',
  '| Mood | PHQ-4 (Mental Wellness) | POST /api/v1/mood/log/phq4 |',
  '| Mood | Affect Grid (Mood Check) | POST /api/v1/mood/log/affect |',
  '| Mood | Focus & Memory | POST /api/v1/mood/log/focus |',
  '| Mood | Sleep Quality | POST /api/v1/mood/log/sleep |',
  '| Mood | All 4 screens at once | POST /api/v1/mood/log/complete |',
  '| Mood | Log history | GET /api/v1/mood/history |',
  '| Mood | Mental Health predictions | POST /api/v1/mood/predict/mental-health |',
  '| Mood | Metabolic predictions | POST /api/v1/mood/predict/metabolic |',
  '| Mood | Cardio/Neuro predictions | POST /api/v1/mood/predict/cardio-neuro |',
  '| Mood | Reproductive predictions | POST /api/v1/mood/predict/reproductive |',
  '| Mood | Prediction history | GET /api/v1/mood/predictions |',
  '',
  '## Authentication',
  'All endpoints (except `/health` and `/auth/token`) require `Authorization: Bearer <token>`.',
  '',
  '**Token issuance:** The Django backend calls `POST /api/v1/auth/token` with `{ "external_id": "<django_user_uuid>" }` and caches the 24-hour JWT in Redis. All requests to this Node.js API are forwarded by Django with this token attached as a Bearer token. The Node.js backend extracts the `external_id` from the JWT payload and scopes all data operations to that patient.',
  '',
  '**Implicit patient creation:** The first data write from any Django user automatically creates a local patient record — no explicit registration call is needed.',
].join('\n');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI-MSHM Health Prediction API',
      version: '1.0.0',
      description: description,
      contact: { name: 'AI-MSHM Platform' },
    },
    servers: [
      { url: 'https://ai-mshm-menstrual-api.onrender.com', description: 'Production server' },
      { url: 'http://localhost:3000', description: 'Local development server' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        PHQ4Log: {
          type: 'object',
          required: ['phq4_item1', 'phq4_item2', 'phq4_item3', 'phq4_item4'],
          properties: {
            phq4_item1: { type: 'integer', minimum: 0, maximum: 3, description: 'GAD-2 Q1: Feeling nervous/anxious/on edge (0=Not at all, 3=Nearly every day)' },
            phq4_item2: { type: 'integer', minimum: 0, maximum: 3, description: 'GAD-2 Q2: Unable to stop or control worrying' },
            phq4_item3: { type: 'integer', minimum: 0, maximum: 3, description: 'PHQ-2 Q3: Little interest or pleasure in doing things' },
            phq4_item4: { type: 'integer', minimum: 0, maximum: 3, description: 'PHQ-2 Q4: Feeling down, depressed, or hopeless' },
            log_date: { type: 'string', format: 'date', description: 'ISO date string (YYYY-MM-DD). Defaults to today if omitted.' },
          },
        },
        AffectLog: {
          type: 'object',
          required: ['affect_valence', 'affect_arousal'],
          properties: {
            affect_valence: { type: 'integer', minimum: 1, maximum: 3, description: 'How positive do you feel? 1=Very negative, 2=Neutral, 3=Very positive' },
            affect_arousal: { type: 'integer', minimum: 1, maximum: 3, description: 'How energised do you feel? 1=Calm/sleepy, 2=Neutral, 3=Excited/alert' },
            log_date: { type: 'string', format: 'date', description: 'ISO date string (YYYY-MM-DD). Defaults to today if omitted.' },
          },
        },
        FocusLog: {
          type: 'object',
          required: ['focus_score', 'memory_score', 'mental_fatigue'],
          properties: {
            focus_score: { type: 'integer', minimum: 1, maximum: 10, description: 'How well were you able to concentrate? 1=Very scattered, 10=Laser-focused' },
            memory_score: { type: 'integer', minimum: 1, maximum: 10, description: 'How well were you able to remember things? 1=Very forgetful, 10=Sharp recall' },
            mental_fatigue: { type: 'integer', minimum: 1, maximum: 10, description: 'How mentally drained do you feel? 1=Completely drained, 10=Mentally fresh' },
            log_date: { type: 'string', format: 'date', description: 'ISO date string (YYYY-MM-DD). Defaults to today if omitted.' },
          },
        },
        SleepLog: {
          type: 'object',
          required: ['sleep_quality', 'hours_slept'],
          properties: {
            sleep_quality: { type: 'integer', minimum: 1, maximum: 10, description: 'How restful was your sleep? 1=Very poor, 10=Excellent' },
            hours_slept: { type: 'number', minimum: 0, maximum: 12, description: 'Total hours slept (0-12)' },
            log_date: { type: 'string', format: 'date', description: 'ISO date string (YYYY-MM-DD). Defaults to today if omitted.' },
          },
        },
        CompleteMoodLog: {
          type: 'object',
          required: ['phq4_item1', 'phq4_item2', 'phq4_item3', 'phq4_item4', 'affect_valence', 'affect_arousal', 'focus_score', 'memory_score', 'mental_fatigue', 'sleep_quality', 'hours_slept'],
          properties: {
            phq4_item1: { type: 'integer', minimum: 0, maximum: 3, description: 'GAD-2 Q1: Feeling nervous/anxious/on edge' },
            phq4_item2: { type: 'integer', minimum: 0, maximum: 3, description: 'GAD-2 Q2: Unable to stop or control worrying' },
            phq4_item3: { type: 'integer', minimum: 0, maximum: 3, description: 'PHQ-2 Q3: Little interest or pleasure in doing things' },
            phq4_item4: { type: 'integer', minimum: 0, maximum: 3, description: 'PHQ-2 Q4: Feeling down, depressed, or hopeless' },
            affect_valence: { type: 'integer', minimum: 1, maximum: 3, description: 'How positive do you feel? 1=Very negative, 2=Neutral, 3=Very positive' },
            affect_arousal: { type: 'integer', minimum: 1, maximum: 3, description: 'How energised do you feel? 1=Calm/sleepy, 2=Neutral, 3=Excited/alert' },
            focus_score: { type: 'integer', minimum: 1, maximum: 10, description: 'Concentration rating (1=Very scattered, 10=Laser-focused)' },
            memory_score: { type: 'integer', minimum: 1, maximum: 10, description: 'Memory rating (1=Very forgetful, 10=Sharp recall)' },
            mental_fatigue: { type: 'integer', minimum: 1, maximum: 10, description: 'Mental fatigue rating (1=Completely drained, 10=Mentally fresh)' },
            sleep_quality: { type: 'integer', minimum: 1, maximum: 10, description: 'Sleep quality (1=Very poor, 10=Excellent)' },
            hours_slept: { type: 'number', minimum: 0, maximum: 12, description: 'Total hours slept (0-12)' },
            cycle_phase: { type: 'string', enum: ['Menstrual', 'Follicular', 'Ovulatory', 'Luteal'], nullable: true, description: 'Current cycle phase - enables phase-specific PMDD analysis' },
            log_date: { type: 'string', format: 'date', description: 'ISO date string (YYYY-MM-DD). Defaults to today if omitted.' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

const specs = swaggerJsdoc(options);

module.exports = { specs };
