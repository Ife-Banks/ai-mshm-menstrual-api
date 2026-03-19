# AI-MSHM Menstrual Cycle Risk Prediction API

Production-ready Node.js + Express REST API for predicting menstrual cycle disease risks using ONNX runtime and PostgreSQL for persistent storage.

## Prerequisites

- **Node.js** 18+
- **Python** 3.9+ (for one-time ONNX conversion only)
- **PostgreSQL** 13+ (for data storage)

## Setup

```bash
# Install dependencies
npm install

# Set up PostgreSQL database
createdb mshm_menstrual_db
psql mshm_menstrual_db -c "CREATE USER mshm_user WITH PASSWORD 'your_password';"
psql mshm_menstrual_db -c "GRANT ALL PRIVILEGES ON DATABASE mshm_menstrual_db TO mshm_user;"

# Run Prisma migrations
npx prisma migrate dev --name init
npx prisma generate

# Place the pkl bundle at project root
cp /path/to/ai_mshm_menstrual_pipeline.pkl ./

# Run the Python ONNX conversion (one-time)
npm run convert

# Copy and configure environment variables
cp .env.example .env
# Edit .env with DATABASE_URL and JWT_SECRET

# Start the server
npm run dev
```

## API Documentation

**Swagger UI**: http://localhost:3000/api-docs

## Authentication

All prediction endpoints require `Authorization: Bearer <token>`.

### Get Test Token (Development Only)

```bash
curl -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"client_id": "test", "secret": "test"}'
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/menstrual/log-cycle` | Log one cycle → saved to DB |
| POST | `/api/v1/menstrual/predict` | Predict using stored cycles → saves result |
| POST | `/api/v1/menstrual/predict/from-logs` | Batch submit + predict (stateless) |
| GET | `/api/v1/menstrual/history` | All stored cycles for this user |
| GET | `/api/v1/menstrual/predictions` | All stored prediction results |
| GET | `/api/v1/menstrual/features` | Feature schema reference |
| GET | `/api/v1/menstrual/model-info` | Model metadata |
| GET | `/api/v1/health` | Liveness probe |

## Mobile App Integration Flow

```
1. User opens app → logs period start date (date picker)
2. During period → user logs daily bleeding intensity (1–4)
3. Period ends → user marks period end date
   → App calls POST /api/v1/menstrual/log-cycle

4. After ≥ 1 cycle → app can call POST /api/v1/menstrual/predict
   → Server fetches ALL stored cycles for this user
   → Aggregates into 10 model features
   → Runs ONNX inference
   → Saves prediction result
   → Returns risk scores for 6 diseases

5. App can call GET /api/v1/menstrual/history to show cycle history
6. App can call GET /api/v1/menstrual/predictions to show risk trend over time

NOTE: CLV (Cycle Length Variability) only becomes meaningful at ≥ 3 cycles.
      The API still works with 1 cycle — CLV defaults to 0.
      Accuracy improves with each additional cycle logged.
```

### User-Logged Input Schema (log-cycle endpoint)

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

| Field | Source | Description |
|-------|--------|-------------|
| `period_start_date` | User (date picker) | Period start date in ISO format |
| `period_end_date` | User (date picker) | Period end date in ISO format |
| `bleeding_scores` | User (daily selection) | Array of daily bleeding intensity: 1=Spotting, 2=Light, 3=Medium, 4=Heavy |
| `has_ovulation_peak` | User (BBT/rPPG) | Boolean: did the cycle show an ovulation peak? |
| `unusual_bleeding` | User (flagged) | Boolean: any bleeding outside the period? |
| `rppg_ovulation_day` | Wearable/camera (optional) | rPPG-detected ovulation day override |

## Feature Descriptions (Internal Model Features)

| Feature | Type | Range | Description |
|---------|------|-------|-------------|
| CLV | number | 0 to ∞ | Cycle Length Variability — std dev of cycle lengths (days). Use 0 if < 3 cycles logged. |
| mean_cycle_len | number | 10 to 90 | Mean cycle length in days across all logged cycles. |
| mean_luteal | number | 0 to 30 | Mean luteal phase length in days. Use 14 if unknown. |
| luteal_std | number | 0 to ∞ | Std dev of luteal phase length. Use 0 if < 3 cycles. |
| anovulatory_rate | number | 0 to 1 | Fraction of cycles with no detected ovulation peak (0–1). 0 = always ovulated. |
| mean_menses_len | number | 0 to 14 | Mean menstrual bleeding length in days. |
| mean_menses_score | number | 0 to 24 | Mean total menses score — cumulative daily bleeding score (Spotting=1, Light=2, Medium=3, Heavy=4) summed per period. |
| unusual_bleed_rate | number | 0 to 1 | Fraction of cycles with unusual/intermenstrual bleeding flagged (0–1). |
| mean_fertility_days | number | 0 to 30 | Mean number of fertile window days per cycle. |
| n_cycles | integer | 1 to ∞ | Total number of cycles logged by this client. |

## Disease Output Schema

Each disease prediction returns:

```json
{
  "risk_probability": 0.1823,
  "risk_score": 0.1677,
  "risk_flag": 0,
  "severity": "Minimal",
  "threshold_used": 0.5
}
```

### Flag Thresholds

| Disease | Threshold |
|---------|-----------|
| Infertility | ≥ 0.50 |
| Dysmenorrhea | ≥ 0.50 |
| PMDD | ≥ 0.60 |
| Endometrial Cancer | ≥ 0.50 |
| Type 2 Diabetes (T2D) | ≥ 0.50 |
| Cardiovascular Disease (CVD) | ≥ 0.50 |

### Severity Levels

| Score Range | Severity |
|-------------|----------|
| 0.00 – 0.19 | Minimal |
| 0.20 – 0.39 | Mild |
| 0.40 – 0.59 | Moderate |
| 0.60 – 0.79 | Severe |
| 0.80 – 1.00 | Extreme |

## Database Schema

The API uses PostgreSQL with Prisma ORM. Tables:

- **User** — Maps JWT `sub` claim to local user ID
- **CycleLog** — Individual cycle records with computed features
- **PredictionResult** — Prediction history for audit and trends

## Deployment Notes

- The `models/onnx/` directory must be present at runtime with all ONNX model files
- Run `npm run convert` before deployment to generate ONNX models from the pkl bundle
- Run `npx prisma migrate deploy` in production to apply schema migrations
- Ensure `JWT_SECRET` and `DATABASE_URL` are set correctly in production
- The `/api/v1/auth/token` endpoint is disabled in production

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |
| `npm run convert` | Run Python ONNX conversion script |
| `npx prisma migrate dev` | Create/apply database migrations |
| `npx prisma generate` | Generate Prisma Client |
# ai-mshm-menstrual-api
