const ort = require('onnxruntime-node');
const path = require('path');
const fs = require('fs');

let v8Sessions = null;
let v8Meta = null;

const TARGET_ALGOS = [
  'LinearRegression', 'RandomForest',
];

const RISK_DOMAINS = [
  'Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Check',
  'Metabolic_Syndrome', 'Type_2_Diabetes', 'Cardiovascular_Disease',
  'Heart_Failure', 'Chronic_Stress', 'Infertility',
];

const MOOD_ALGOS = [
  'LightGBM', 'ExtraTrees', 'KNN', 'RandomForest', 'SVM', 'MLP',
];

const DL_TARGETS = ['Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Score'];
const DL_MODELS = ['lstm_attn', 'transformer'];

function safePath(...parts) {
  return path.join(...parts);
}

async function loadV8Models() {
  const baseDir = process.env.RPPG_V8_MODELS_DIR || './models/rppg_v8';
  const onnxDir = path.join(baseDir, 'onnx');
  const metaPath = path.join(baseDir, 'v8_training_metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.warn('[RppgV8ModelLoader] ⚠ No v8_training_metadata.json found. Run export_v8_models.py first.');
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const loaded = {
    regression: {},
    risk: { classifiers: {}, regressors: {} },
    mood: {},
    dl: {},
    metadata: meta,
  };

  // ── 1. Load regression models ────────────────────────────────────────────
  for (const target of meta.regression_targets || []) {
    loaded.regression[target] = {};
    for (const algo of TARGET_ALGOS) {
      const onnxPath = safePath(onnxDir, `reg_${target}_${algo}.onnx`);
      if (fs.existsSync(onnxPath)) {
        loaded.regression[target][algo] = await ort.InferenceSession.create(onnxPath);
        console.log(`[RppgV8ModelLoader] ✓ reg/${target}/${algo}`);
      }
    }
  }

  // ── 2. Load risk scoring models ──────────────────────────────────────────
  for (const domain of RISK_DOMAINS) {
    const regPath = safePath(onnxDir, `risk_${domain}_regressor.onnx`);
    const clfPath = safePath(onnxDir, `risk_${domain}_classifier.onnx`);

    if (fs.existsSync(regPath)) {
      loaded.risk.regressors[domain] = await ort.InferenceSession.create(regPath);
      console.log(`[RppgV8ModelLoader] ✓ risk/${domain}/regressor`);
    }
    if (fs.existsSync(clfPath)) {
      loaded.risk.classifiers[domain] = await ort.InferenceSession.create(clfPath);
      console.log(`[RppgV8ModelLoader] ✓ risk/${domain}/classifier`);
    }
  }

  // ── 3. Load Mood_Check classifiers ───────────────────────────────────────
  for (const algo of MOOD_ALGOS) {
    const onnxPath = safePath(onnxDir, `mood_check_${algo}.onnx`);
    if (fs.existsSync(onnxPath)) {
      loaded.mood[algo] = await ort.InferenceSession.create(onnxPath);
      console.log(`[RppgV8ModelLoader] ✓ mood/${algo}`);
    }
  }

  // ── 4. Load Deep Learning models (may not exist) ─────────────────────────
  for (const target of DL_TARGETS) {
    loaded.dl[target] = {};
    for (const modelType of DL_MODELS) {
      const key = `${target}_${modelType}`;
      const onnxPath = safePath(onnxDir, `dl_${key}.onnx`);
      if (fs.existsSync(onnxPath)) {
        try {
          loaded.dl[target][modelType] = await ort.InferenceSession.create(onnxPath);
          console.log(`[RppgV8ModelLoader] ✓ dl/${key}`);
        } catch (e) {
          console.warn(`[RppgV8ModelLoader] ⚠ dl/${key} failed to load: ${e.message}`);
        }
      }
    }
  }

  v8Sessions = loaded;
  v8Meta = meta;

  const nReg = Object.values(loaded.regression).reduce((sum, t) => sum + Object.keys(t).length, 0);
  const nRisk = Object.keys(loaded.risk.regressors).length + Object.keys(loaded.risk.classifiers).length;
  const nMood = Object.keys(loaded.mood).length;
  const nDl = Object.values(loaded.dl).reduce((sum, t) => sum + Object.keys(t).length, 0);
  console.log(`[RppgV8ModelLoader] All v8 models ready — ${nReg} regression, ${nRisk} risk, ${nMood} mood, ${nDl} DL`);
}

function getV8Sessions() { return v8Sessions; }
function getV8Metadata() { return v8Meta; }

module.exports = { loadV8Models, getV8Sessions, getV8Metadata };
