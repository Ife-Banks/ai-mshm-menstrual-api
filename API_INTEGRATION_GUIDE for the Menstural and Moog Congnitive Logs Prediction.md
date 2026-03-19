# AI-MSHM API Integration Guide
### For Web & Mobile Frontend Developers

> **API Base URL**: `https://your-api.onrender.com/api/v1`  
> **Swagger UI**: `https://your-api.onrender.com/api-docs`  
> **API Version**: 1.0.0

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Standard Response Format](#3-standard-response-format)
4. [Error Handling](#4-error-handling)
5. [Menstrual Cycle Tracking](#5-menstrual-cycle-tracking)
6. [Mood & Cognitive Logging](#6-mood--cognitive-logging)
7. [Prediction Endpoints](#7-prediction-endpoints)
8. [Data Models](#8-data-models)
9. [Mobile Considerations](#9-mobile-considerations)
10. [Web Considerations](#10-web-considerations)
11. [Rate Limits & Best Practices](#11-rate-limits--best-practices)

---

## 1. Overview

The AI-MSHM API provides two main health prediction modules:

| Module | What it tracks | Diseases predicted |
|---|---|---|
| **Menstrual Cycle** | Period dates, bleeding scores, ovulation | Infertility, Dysmenorrhea, PMDD, Endometrial, T2D, CVD |
| **Mood & Cognitive** | PHQ-4, Affect, Focus, Sleep | Anxiety, Depression, PMDD, ChronicStress, CVD, T2D, Infertility, Stroke, MetSyn |

Both modules share the same API and database — a user logs both cycle data and mood data, and gets predictions from both.

---

## 2. Authentication

All endpoints require a **JWT Bearer token**.

### Getting a Token

```http
POST /api/v1/auth/token
Content-Type: application/json

{
  "external_id": "user_123"
}
```

**Response:**
```json
{
  "success": true,
  "status": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 86400
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

### Using the Token

Include it in the `Authorization` header on every request:

```http
GET /api/v1/menstrual/history
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Expiry
- Tokens expire after **24 hours**
- Store the token securely (see [Mobile](#9-mobile-considerations) and [Web](#10-web-considerations) sections)
- On 401 responses, re-authenticate and retry

---

## 3. Standard Response Format

Every response follows this envelope:

```json
{
  "success": true,
  "status": 200,
  "message": "Cycle logged successfully",
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-03-19T12:00:00.000Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | `true` if the request succeeded, `false` if it failed |
| `status` | `integer` | HTTP status code |
| `message` | `string` | Human-readable description |
| `data` | `object` | The payload — varies per endpoint |
| `meta` | `object` | Always contains `request_id` and `timestamp` |

---

## 4. Error Handling

### Error Response Format

```json
{
  "success": false,
  "status": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "bleeding_scores", "message": "bleeding_scores must be an array of integers between 1 and 4" }
  ],
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-03-19T12:00:00.000Z"
  }
}
```

### Common HTTP Status Codes

| Status | Meaning | When you'll see it |
|---|---|---|
| `200` | OK | Successful read/write |
| `201` | Created | Resource successfully created |
| `401` | Unauthorized | Missing or invalid JWT token |
| `422` | Validation Error | Request body failed Joi validation |
| `500` | Server Error | Internal error — contact support |

### Retry Strategy

```javascript
// Recommended retry logic
async function apiCallWithRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 401) {
        // Re-authenticate
        await refreshToken();
        continue;
      }
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}
```

---

## 5. Menstrual Cycle Tracking

### 5.1 Log a Cycle

Call this **at the end of each period** when the user completes their cycle log.

```http
POST /api/v1/menstrual/log-cycle
Authorization: Bearer <token>
Content-Type: application/json

{
  "period_start_date": "2026-03-04",
  "period_end_date": "2026-03-09",
  "bleeding_scores": [2, 3, 3, 2, 1],
  "has_ovulation_peak": true,
  "unusual_bleeding": false,
  "rppg_ovulation_day": null
}
```

**Request Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `period_start_date` | `string` (YYYY-MM-DD) | Yes | First day of bleeding |
| `period_end_date` | `string` (YYYY-MM-DD) | Yes | Last day of bleeding |
| `bleeding_scores` | `array[int]` | Yes | Daily bleeding: `1`=Spotting, `2`=Light, `3`=Medium, `4`=Heavy |
| `has_ovulation_peak` | `boolean` | Yes | Did BBT/rPPG detect ovulation? |
| `unusual_bleeding` | `boolean` | Yes | Any bleeding outside the normal period? |
| `rppg_ovulation_day` | `integer` or `null` | No | Day of cycle when ovulation was detected by sensor |

**Response:**
```json
{
  "success": true,
  "status": 201,
  "message": "Cycle logged successfully",
  "data": {
    "cycle": {
      "id": "uuid",
      "periodStartDate": "2026-03-04T00:00:00.000Z",
      "periodEndDate": "2026-03-09T00:00:00.000Z",
      "cycleLength": 29,
      "mensesLength": 5,
      "cycleNumber": 3
    },
    "updated_aggregates": {
      "CLV": 2.34,
      "mean_cycle_len": 29.5,
      "mean_luteal": 14.0,
      "luteal_std": 1.2,
      "anovulatory_rate": 0.0,
      "mean_menses_len": 4.8,
      "mean_menses_score": 11.2,
      "unusual_bleed_rate": 0.0,
      "mean_fertility_days": 6.0,
      "n_cycles": 3
    },
    "total_cycles_stored": 3,
    "criterion_flags": {
      "criterion_1_positive": 0,
      "criteria": [
        { "criterion": 1, "condition": "oligomenorrhea", "triggered": false, "value": 29.5, "threshold": 35 },
        { "criterion": 2, "condition": "amenorrhea_risk", "triggered": false, "value": 37.8, "threshold": 8 },
        { "criterion": 3, "condition": "irregular_cycle_pattern", "triggered": false, "value": 2.34, "threshold": 7 }
      ],
      "summary": "No menstrual irregularity flags detected"
    }
  },
  "meta": { ... }
}
```

### 5.2 Get Cycle History

```http
GET /api/v1/menstrual/history
Authorization: Bearer <token>
```

**Response:** Returns all stored cycles with aggregates and criterion flags.

### 5.3 Get Feature Schema

```http
GET /api/v1/menstrual/features
Authorization: Bearer <token>
```

Returns the 10 feature names and their descriptions used by the prediction model.

### 5.4 Get Model Info

```http
GET /api/v1/menstrual/model-info
Authorization: Bearer <token>
```

Returns disease list, flag thresholds, severity bins, and model metrics.

---

## 6. Mood & Cognitive Logging

There are **5 ways** to log mood data:

| Endpoint | When to use |
|---|---|
| `POST /log/phq4` | User completes only the PHQ-4 screen |
| `POST /log/affect` | User completes only the Affect Grid screen |
| `POST /log/focus` | User completes only the Focus & Memory screen |
| `POST /log/sleep` | User completes only the Sleep Quality screen |
| `POST /log/complete` | User completes all 4 screens at once |

All 4 individual endpoints **merge data into the same daily log** — a user can log PHQ-4 in the morning and Focus in the afternoon, and both will be saved to the same day's record.

### 6.1 PHQ-4 (Mental Wellness)

```http
POST /api/v1/mood/log/phq4
Authorization: Bearer <token>
Content-Type: application/json

{
  "phq4_item1": 1,
  "phq4_item2": 2,
  "phq4_item3": 1,
  "phq4_item4": 0,
  "log_date": "2026-03-19"
}
```

**PHQ-4 Item Descriptions:**

| Item | Question | Scale |
|---|---|---|
| `phq4_item1` | Feeling nervous, anxious, or on edge | 0=Not at all, 1=Several days, 2=More than half days, 3=Nearly every day |
| `phq4_item2` | Not being able to stop or control worrying | 0–3 same scale |
| `phq4_item3` | Little interest or pleasure in doing things | 0–3 same scale |
| `phq4_item4` | Feeling down, depressed, or hopeless | 0–3 same scale |

**Anxiety subscale** = item1 + item2 (max 6)  
**Depression subscale** = item3 + item4 (max 6)

**Anxiety flag** is raised when `anxiety_subscale >= 3`  
**Depression flag** is raised when `depression_subscale >= 3`

**Response:**
```json
{
  "success": true,
  "status": 200,
  "message": "PHQ-4 logged successfully",
  "data": {
    "phq4_anxiety_score": 3,
    "phq4_depression_score": 1,
    "phq4_total": 4,
    "log_date": "2026-03-19T00:00:00.000Z"
  }
}
```

### 6.2 Affect Grid (Mood Check)

```http
POST /api/v1/mood/log/affect
Authorization: Bearer <token>
Content-Type: application/json

{
  "affect_valence": 2,
  "affect_arousal": 2,
  "log_date": "2026-03-19"
}
```

| Field | Scale | Meaning |
|---|---|---|
| `affect_valence` | 1=Very negative, 2=Neutral, 3=Very positive | How positive/negative do you feel? |
| `affect_arousal` | 1=Calm/sleepy, 2=Neutral, 3=Excited/alert | How energised/aroused do you feel? |

**Affect Quadrants:**

| Valence × Arousal | Quadrant Label |
|---|---|
| 1-1 | Depressed-Fatigued |
| 1-2 | Sad-Flat |
| 1-3 | Anxious-Agitated |
| 2-1 | Quiet-Neutral |
| 2-2 | Neutral |
| 2-3 | Alert-Neutral |
| 3-1 | Content |
| 3-2 | Calm-Relaxed |
| 3-3 | Happy-Energised |

### 6.3 Focus & Memory

```http
POST /api/v1/mood/log/focus
Authorization: Bearer <token>
Content-Type: application/json

{
  "focus_score": 7,
  "memory_score": 6,
  "mental_fatigue": 4,
  "log_date": "2026-03-19"
}
```

| Field | Scale | Description |
|---|---|---|
| `focus_score` | 1–10 | How well could you concentrate? (1=Very scattered, 10=Laser-focused) |
| `memory_score` | 1–10 | How well could you remember things? (1=Very forgetful, 10=Sharp recall) |
| `mental_fatigue` | 1–10 | How mentally drained do you feel? (1=Completely drained, 10=Mentally fresh) |

### 6.4 Sleep Quality

```http
POST /api/v1/mood/log/sleep
Authorization: Bearer <token>
Content-Type: application/json

{
  "sleep_quality": 7,
  "hours_slept": 7.5,
  "log_date": "2026-03-19"
}
```

| Field | Scale | Description |
|---|---|---|
| `sleep_quality` | 1–10 | How restful was your sleep? (1=Very poor, 10=Excellent) |
| `hours_slept` | 0–12 | Total hours slept |

### 6.5 Log All at Once

```http
POST /api/v1/mood/log/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "phq4_item1": 1,
  "phq4_item2": 2,
  "phq4_item3": 1,
  "phq4_item4": 0,
  "affect_valence": 2,
  "affect_arousal": 2,
  "focus_score": 7,
  "memory_score": 6,
  "mental_fatigue": 4,
  "sleep_quality": 7,
  "hours_slept": 7.5,
  "cycle_phase": "Luteal",
  "log_date": "2026-03-19"
}
```

The `cycle_phase` field is optional. Valid values: `"Menstrual"`, `"Follicular"`, `"Ovulatory"`, `"Luteal"`. It enables phase-specific PMDD analysis.

### 6.6 Get Mood History

```http
GET /api/v1/mood/history
Authorization: Bearer <token>
```

Returns the last 30 daily mood logs.

---

## 7. Prediction Endpoints

### 7.1 Menstrual Predictions

```http
POST /api/v1/menstrual/predict
Authorization: Bearer <token>
```

Fetches all stored cycles, aggregates them into features, runs inference, and returns predictions.

**Response:**
```json
{
  "success": true,
  "status": 200,
  "message": "Prediction completed successfully",
  "data": {
    "predictions": {
      "Infertility": {
        "risk_probability": 0.124,
        "risk_score": 0.31,
        "risk_flag": 0,
        "severity": "Mild",
        "threshold_used": 0.5
      },
      "Dysmenorrhea": {
        "risk_probability": 0.872,
        "risk_score": 0.67,
        "risk_flag": 1,
        "severity": "Moderate",
        "threshold_used": 0.5
      },
      "PMDD": { ... },
      "Endometrial": { ... },
      "T2D": { ... },
      "CVD": { ... }
    },
    "derived_features": { ... },
    "cycles_used": 5,
    "model_module": "Menstrual Cycle Tracking — Layer 2 Active Input",
    "criterion_flags": {
      "criterion_1_positive": 1,
      "criteria": [
        { "criterion": 1, "condition": "oligomenorrhea", "triggered": false, ... },
        { "criterion": 2, "condition": "amenorrhea_risk", "triggered": false, ... },
        { "criterion": 3, "condition": "irregular_cycle_pattern", "triggered": true, ... }
      ],
      "summary": "Criterion 1 positive: irregular_cycle_pattern"
    }
  }
}
```

### 7.2 Mood Predictions (4 Groups)

All mood prediction endpoints require **at least 3 daily logs** before they can run.

```http
POST /api/v1/mood/predict/mental-health
Authorization: Bearer <token>
```

**Diseases assessed:** Anxiety, Depression, PMDD, ChronicStress

```http
POST /api/v1/mood/predict/metabolic
Authorization: Bearer <token>
```

**Diseases assessed:** T2D_Mood, MetSyn_Mood

```http
POST /api/v1/mood/predict/cardio-neuro
Authorization: Bearer <token>
```

**Diseases assessed:** CVD_Mood, Stroke_Mood

```http
POST /api/v1/mood/predict/reproductive
Authorization: Bearer <token>
```

**Diseases assessed:** Infertility_Mood

**Mental Health Response:**
```json
{
  "success": true,
  "status": 200,
  "message": "Mental health risk scores computed",
  "data": {
    "group": "mental_health",
    "diseases_assessed": ["Anxiety", "Depression", "PMDD", "ChronicStress"],
    "logs_used": 14,
    "highest_risk": "Depression",
    "any_flag_raised": true,
    "predictions": {
      "Anxiety": {
        "risk_probability": 0.34,
        "risk_score": 0.52,
        "risk_flag": 1,
        "severity": "Moderate"
      },
      "Depression": {
        "risk_probability": 0.61,
        "risk_score": 0.74,
        "risk_flag": 1,
        "severity": "Severe"
      },
      "PMDD": { ... },
      "ChronicStress": { ... }
    },
    "critical_flag": true,
    "critical_message": "Depression risk flag raised — clinical review recommended"
  }
}
```

### 7.3 Severity Levels

All predictions return a `severity` field:

| Severity | Score Range | Meaning |
|---|---|---|
| `Minimal` | 0.00–0.19 | Very low risk |
| `Mild` | 0.20–0.39 | Low risk |
| `Moderate` | 0.40–0.59 | Moderate risk — monitor |
| `Severe` | 0.60–0.79 | High risk — follow up |
| `Extreme` | 0.80–1.00 | Very high risk — urgent attention |

### 7.4 Get Prediction History

```http
GET /api/v1/menstrual/predictions
Authorization: Bearer <token>
```

```http
GET /api/v1/mood/predictions
Authorization: Bearer <token>
```

---

## 8. Data Models

### 8.1 Disease Flag Thresholds

| Disease | Flag Threshold | Meaning |
|---|---|---|
| **Infertility** | 0.50 | Flag raised when risk_score >= 0.50 |
| **Dysmenorrhea** | 0.50 | Flag raised when risk_score >= 0.50 |
| **PMDD** | 0.60 | Flag raised when risk_score >= 0.60 |
| **Endometrial** | 0.50 | Flag raised when risk_score >= 0.50 |
| **T2D** | 0.50 | Flag raised when risk_score >= 0.50 |
| **CVD** | 0.50 | Flag raised when risk_score >= 0.50 |
| **Anxiety** | 0.30 | Flag raised when risk_score >= 0.30 |
| **Depression** | 0.30 | Flag raised when risk_score >= 0.30 |
| **ChronicStress** | 0.35 | Flag raised when risk_score >= 0.35 |

### 8.2 Criterion 1 — Menstrual Irregularity Flags

These flags are computed from cycle data and returned in every menstrual response:

| Condition | Triggered When | Value |
|---|---|---|
| `oligomenorrhea` | Mean cycle length > 35 days | Mean cycle length in days |
| `amenorrhea_risk` | Annual cycle frequency < 8 | Computed as (n_cycles / total_days) × 365 |
| `irregular_cycle_pattern` | CLV (cycle std dev) > 7 days | CLV value |

If **any** of these are triggered, `criterion_1_positive = 1`.

### 8.3 Feature Descriptions (Menstrual)

| Feature | Description |
|---|---|
| `CLV` | Cycle Length Variability — standard deviation of cycle lengths in days |
| `mean_cycle_len` | Mean cycle length in days |
| `mean_luteal` | Mean luteal phase length in days |
| `luteal_std` | Std dev of luteal phase length |
| `anovulatory_rate` | Fraction of cycles with no ovulation peak (0–1) |
| `mean_menses_len` | Mean menstrual bleeding length in days |
| `mean_menses_score` | Mean total menses score (sum of daily bleeding intensity) |
| `unusual_bleed_rate` | Fraction of cycles with unusual bleeding (0–1) |
| `mean_fertility_days` | Mean fertile window days per cycle |
| `n_cycles` | Total number of cycles logged |

---

## 9. Mobile Considerations

### 9.1 Token Storage

On mobile, store the JWT securely — **never** in local storage or AsyncStorage in plain text.

| Platform | Recommended Storage |
|---|---|
| **React Native (Expo)** | `SecureStore` |
| **React Native (CLI)** | `react-native-keychain` |
| **Flutter** | `flutter_secure_storage` |
| **Kotlin (Android)** | EncryptedSharedPreferences |
| **Swift (iOS)** | Keychain |

### 9.2 Network Layer

Use a centralized API client:

```javascript
// Example: React Native / Expo
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({
  baseURL: 'https://your-api.onrender.com/api/v1',
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired — re-authenticate
      await SecureStore.deleteItemAsync('auth_token');
      // Navigate to login
    }
    return Promise.reject(error);
  }
);

export default api;
```

### 9.3 Offline Support

For mood logging, queue entries when offline and sync when connected:

```javascript
// Pseudocode for offline mood logging
async function logMood(screenData) {
  if (navigator.onLine) {
    await api.post(`/mood/log/${screen}`, screenData);
  } else {
    // Store locally
    const queue = await AsyncStorage.getItem('mood_queue') || '[]';
    queue.push({ ...screenData, timestamp: Date.now() });
    await AsyncStorage.setItem('mood_queue', JSON.stringify(queue));
  }
}

// Sync when back online
window.addEventListener('online', async () => {
  const queue = JSON.parse(await AsyncStorage.getItem('mood_queue') || '[]');
  for (const entry of queue) {
    await api.post(`/mood/log/complete`, entry);
  }
  await AsyncStorage.removeItem('mood_queue');
});
```

### 9.4 Push Notifications

When a prediction returns a critical flag, trigger a local notification:

```javascript
// Example: React Native
if (prediction.critical_flag) {
  Notifications.scheduleNotificationAsync({
    content: {
      title: "Health Alert",
      body: prediction.critical_message,
    },
    trigger: { seconds: 1 },
  });
}
```

### 9.5 Background Sync (iOS/Android)

For cycle logging, consider using background fetch to remind users to log:

```javascript
// React Native: useEffect with AppState listener
useEffect(() => {
  AppState.addEventListener('change', handleAppStateChange);
  
  // If app opened and period dates are missing for today,
  // show an in-app reminder
}, []);
```

### 9.6 Date Handling

Always send dates as **ISO 8601 strings (YYYY-MM-DD)**. Be mindful of timezone — convert local time to UTC before sending:

```javascript
// Convert local date to ISO string
const toISODate = (date) => {
  const d = new Date(date);
  return d.toISOString().split('T')[0]; // "2026-03-19"
};
```

---

## 10. Web Considerations

### 10.1 Token Storage

On web, use **HttpOnly cookies** for maximum security. If using localStorage, be aware of XSS risks.

**Recommended: HttpOnly Cookie (server-set)**

The backend sets the JWT in an HttpOnly cookie on `/auth/token`. The browser sends it automatically on every request. This is the most secure approach.

**Alternative: localStorage (simpler)**

```javascript
// Store
localStorage.setItem('mshm_token', token);

// Retrieve
const token = localStorage.getItem('mshm_token');

// Use in requests
fetch('/api/v1/menstrual/history', {
  headers: { Authorization: `Bearer ${token}` }
});

// Clear on logout
localStorage.removeItem('mshm_token');
```

### 10.2 API Client Setup

```javascript
// Example: JavaScript/TypeScript web app
const API_BASE = 'https://your-api.onrender.com/api/v1';

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE;
    this.token = localStorage.getItem('mshm_token');
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.message || 'API error');
    }
    return json;
  }

  // Convenience methods
  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
}

// Usage
const api = new ApiClient();
const history = await api.get('/menstrual/history');
const result = await api.post('/menstrual/log-cycle', cycleData);
```

### 10.3 React Example

```javascript
// api.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mshm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('mshm_token');
      window.location.href = '/login';
    }
    return Promise.reject(error.response?.data || error);
  }
);

export default api;

// Usage in a component
import api from './api';

// Log a cycle
const handleCycleLog = async (cycleData) => {
  try {
    const result = await api.post('/menstrual/log-cycle', cycleData);
    console.log('Predictions:', result.data.predictions);
  } catch (err) {
    console.error('Failed to log cycle:', err.message);
  }
};
```

### 10.4 Vue.js Example

```javascript
// src/api/index.js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mshm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default {
  // Menstrual
  logCycle: (data) => api.post('/menstrual/log-cycle', data),
  getHistory: () => api.get('/menstrual/history'),
  runPrediction: () => api.post('/menstrual/predict'),

  // Mood
  logPHQ4: (data) => api.post('/mood/log/phq4', data),
  logAffect: (data) => api.post('/mood/log/affect', data),
  logFocus: (data) => api.post('/mood/log/focus', data),
  logSleep: (data) => api.post('/mood/log/sleep', data),
  logComplete: (data) => api.post('/mood/log/complete', data),
  getMoodHistory: () => api.get('/mood/history'),
  runMoodPrediction: (group) => api.post(`/mood/predict/${group}`),
};
```

### 10.5 SWR / React Query for Data Fetching

```javascript
// React with SWR
import useSWR from 'swr';

function CycleHistory() {
  const { data, error, isLoading } = useSWR(
    '/menstrual/history',
    (url) => api.get(url).then(r => r.data),
    { refreshInterval: 0 } // Don't auto-refresh
  );

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  return <CycleList cycles={data.cycles} />;
}
```

### 10.6 Accessibility

- Use semantic HTML forms for all inputs
- All score inputs (1–10) should use `<input type="range">` sliders with visible labels
- Bleeding score selector should use a segmented control with emoji/icons
- PHQ-4 questions should be read one at a time on mobile
- Color-blind safe palette for prediction severity visualization

---

## 11. Rate Limits & Best Practices

### 11.1 Rate Limits

| Environment | Limit |
|---|---|
| Production (Render) | 100 requests / 15 minutes per IP |
| Development (localhost) | 100 requests / 15 minutes per IP |

### 11.2 Do's and Don'ts

| Do | Don't |
|---|---|
| Store JWT in HttpOnly cookie (web) or SecureStore (mobile) | Store JWT in localStorage on web |
| Retry on 5xx errors with exponential backoff | Spam endpoints repeatedly |
| Log mood data daily for accurate predictions | Log multiple entries for the same day unless requested |
| Show criterion flags to users in plain language | Show raw numbers without context |
| Cache prediction results locally | Call `/predict` on every screen load |
| Use `log_date` field to backfill past dates | Request prediction until you have 3+ logs |

### 11.3 Recommended App Flow

```
1. Onboarding
   └── User registers → POST /auth/token → store token

2. Daily Use (Menstrual)
   └── User logs period end → POST /menstrual/log-cycle
   └── Show aggregates + criterion flags
   └── (Optional) POST /menstrual/predict for full risk report

3. Daily Use (Mood)
   └── User completes PHQ-4 screen → POST /mood/log/phq4
   └── User completes Affect screen → POST /mood/log/affect
   └── User completes Focus screen → POST /mood/log/focus
   └── User completes Sleep screen → POST /mood/log/sleep
   └── OR: All 4 at once → POST /mood/log/complete

4. Periodic Predictions
   └── When user has 3+ mood logs → POST /mood/predict/mental-health
   └── Show risk scores + severity + critical flags
   └── Save prediction to local state for dashboard display

5. Dashboard
   └── Display latest prediction results
   └── Show criterion flags in alert banner if positive
   └── Show critical flags with clinical recommendation message
```

### 11.4 Caching Strategy

```javascript
// Cache predictions locally (both web and mobile)
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getPrediction(type, group = null) {
  const cacheKey = `prediction_${type}_${group || 'default'}`;
  const cached = await AsyncStorage.getItem(cacheKey);
  
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }
  
  const endpoint = group
    ? `/mood/predict/${group}`
    : `/menstrual/predict`;
  
  const result = await api.post(endpoint);
  
  await AsyncStorage.setItem(cacheKey, JSON.stringify({
    data: result.data,
    timestamp: Date.now()
  }));
  
  return result.data;
}
```

---

## Quick Reference: All Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/token` | No | Get JWT token |
| `POST` | `/menstrual/log-cycle` | Yes | Log a cycle |
| `GET` | `/menstrual/history` | Yes | Get cycle history |
| `POST` | `/menstrual/predict` | Yes | Run menstrual predictions |
| `GET` | `/menstrual/predictions` | Yes | Get prediction history |
| `GET` | `/menstrual/features` | Yes | Get feature schema |
| `GET` | `/menstrual/model-info` | Yes | Get model metadata |
| `POST` | `/menstrual/predict/from-logs` | Yes | Batch predict (stateless) |
| `POST` | `/mood/log/phq4` | Yes | Log PHQ-4 screen |
| `POST` | `/mood/log/affect` | Yes | Log Affect Grid |
| `POST` | `/mood/log/focus` | Yes | Log Focus & Memory |
| `POST` | `/mood/log/sleep` | Yes | Log Sleep Quality |
| `POST` | `/mood/log/complete` | Yes | Log all 4 screens |
| `GET` | `/mood/history` | Yes | Get mood log history |
| `POST` | `/mood/predict/mental-health` | Yes | Mental health predictions |
| `POST` | `/mood/predict/metabolic` | Yes | Metabolic predictions |
| `POST` | `/mood/predict/cardio-neuro` | Yes | Cardio/neuro predictions |
| `POST` | `/mood/predict/reproductive` | Yes | Reproductive predictions |
| `GET` | `/mood/predictions` | Yes | Get mood prediction history |
| `GET` | `/health` | No | Health check |

---

## Support

For API issues, contact: **support@ai-mshm.com**  
Swagger UI (interactive docs): `https://your-api.onrender.com/api-docs`
