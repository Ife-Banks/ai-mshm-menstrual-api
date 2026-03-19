# AI-MSHM Health Prediction API

Unified Node.js + Express REST API for predicting health risks based on menstrual cycle and mood/cognitive data using ONNX runtime and PostgreSQL.

## Prerequisites

- **Node.js** 18+
- **Python** 3.9+ (for one-time ONNX conversion only)
- **PostgreSQL** 13+

## Setup

```bash
# Install dependencies
npm install

# Set up PostgreSQL database
createdb mshm_db
psql mshm_db -c "CREATE USER mshm_user WITH PASSWORD 'your_password';"
psql mshm_db -c "GRANT ALL PRIVILEGES ON DATABASE mshm_db TO mshm_user;"

# Run Prisma migrations
npx prisma migrate dev --name init
npx prisma generate

# Place the pkl bundles at project root
cp /path/to/ai_mshm_menstrual_pipeline.pkl ./
cp /path/to/mood_cognitive_all_models.pkl ./

# Run the Python ONNX conversions (one-time)
npm run convert          # Menstrual models
npm run convert:mood     # Mood models

# Copy and configure environment variables
cp .env.example .env
# Edit .env with DATABASE_URL and JWT_SECRET

# Start the server
npm run dev
```

## API Documentation

**Swagger UI**: http://localhost:3000/api-docs

## Authentication

All endpoints require `Authorization: Bearer <token>`.

### Get Test Token (Development Only)

```bash
curl -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"client_id": "test", "secret": "test"}'
```

## API Endpoints

### Menstrual Cycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/menstrual/log-cycle` | Log one menstrual cycle |
| POST | `/api/v1/menstrual/predict` | Predict using stored cycles |
| POST | `/api/v1/menstrual/predict/from-logs` | Batch submit + predict |
| GET | `/api/v1/menstrual/history` | Get cycle history |
| GET | `/api/v1/menstrual/predictions` | Get prediction history |
| GET | `/api/v1/menstrual/features` | Feature schema |
| GET | `/api/v1/menstrual/model-info` | Model metadata |

### Mood & Cognitive

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/mood/log` | Log daily mood/cognitive entry |
| POST | `/api/v1/mood/predict/mental-health` | Anxiety, Depression, PMDD, ChronicStress |
| POST | `/api/v1/mood/predict/metabolic` | T2D_Mood, MetSyn_Mood |
| POST | `/api/v1/mood/predict/cardio-neuro` | CVD_Mood, Stroke_Mood |
| POST | `/api/v1/mood/predict/reproductive` | Infertility_Mood |
| GET | `/api/v1/mood/history` | Get mood log history |
| GET | `/api/v1/mood/predictions` | Get prediction history |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |

## Menstrual Cycle Input

```json
{
  "period_start_date": "2025-03-04",
  "period_end_date": "2025-03-09",
  "bleeding_scores": [2, 3, 3, 2, 1],
  "has_ovulation_peak": true,
  "unusual_bleeding": false,
  "rppg_ovulation_day": null
}
```

## Mood Input (Daily Check-in)

```json
{
  "phq4_item1": 1,
  "phq4_item2": 1,
  "phq4_item3": 0,
  "phq4_item4": 0,
  "affect_valence": 2,
  "affect_arousal": 2,
  "focus_score": 5,
  "memory_score": 5,
  "mental_fatigue": 5,
  "sleep_quality": 7,
  "hours_slept": 7.5,
  "cycle_phase": "Follicular"
}
```

### Mood Screens to Fields

| Screen | Fields | Scale |
|--------|--------|-------|
| Mental Wellness (PHQ-4) | phq4_item1-4 | 0-3 |
| Mood Check (Affect Grid) | affect_valence, affect_arousal | 1-3 |
| Focus & Memory | focus_score, memory_score, mental_fatigue | 1-10 |
| Sleep Quality | sleep_quality, hours_slept | 1-10, 0-12h |

## Disease Thresholds

### Menstrual (6 diseases)
| Disease | Threshold |
|---------|-----------|
| Infertility | ≥ 0.50 |
| Dysmenorrhea | ≥ 0.50 |
| PMDD | ≥ 0.60 |
| Endometrial Cancer | ≥ 0.50 |
| Type 2 Diabetes | ≥ 0.50 |
| Cardiovascular Disease | ≥ 0.50 |

### Mood (9 diseases)
| Disease | Threshold | Group |
|---------|-----------|-------|
| Anxiety | ≥ 0.30 | Mental Health |
| Depression | ≥ 0.30 | Mental Health |
| PMDD | ≥ 0.25 | Mental Health |
| ChronicStress | ≥ 0.35 | Mental Health |
| T2D_Mood | ≥ 0.40 | Metabolic |
| MetSyn_Mood | ≥ 0.40 | Metabolic |
| CVD_Mood | ≥ 0.40 | Cardio/Neuro |
| Stroke_Mood | ≥ 0.40 | Cardio/Neuro |
| Infertility_Mood | ≥ 0.35 | Reproductive |

## Severity Scale

| Score Range | Severity |
|-------------|----------|
| 0.00 – 0.19 | Minimal |
| 0.20 – 0.39 | Mild |
| 0.40 – 0.59 | Moderate |
| 0.60 – 0.79 | Severe |
| 0.80 – 1.00 | Extreme |

## Database Schema

PostgreSQL with Prisma ORM:

- **User** — JWT sub → local user ID
- **CycleLog** — Menstrual cycle records
- **PredictionResult** — Menstrual prediction history
- **MoodCognitiveLog** — Daily mood/cognitive entries
- **MoodPredictionResult** — Mood prediction history

## Deployment Notes

- `models/onnx/` — menstrual ONNX models
- `models/onnx/mood/` — mood ONNX models
- Run `npm run convert` and `npm run convert:mood` before deployment
- Run `npx prisma migrate deploy` in production
- Ensure `JWT_SECRET` and `DATABASE_URL` are set in production

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Production server |
| `npm run dev` | Development server |
| `npm run convert` | Convert menstrual pkl → ONNX |
| `npm run convert:mood` | Convert mood pkl → ONNX |
| `npx prisma migrate dev` | Apply migrations |
| `npx prisma generate` | Generate Prisma Client |
