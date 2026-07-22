const ort = require('onnxruntime-node');
const path = require('path');
const fs = require('fs');

let v8Sessions = null;
let v8Meta = null;

const TARGET_ALGOS = [
  'LinearRegression',
];

const RISK_DOMAINS = [
  'Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Check',
  'Metabolic_Syndrome', 'Type_2_Diabetes', 'Cardiovascular_Disease',
  'Heart_Failure', 'Chronic_Stress', 'Infertility',
];

const MOOD_ALGOS = [
  'MLP',
];

function safePath(...parts) {
  return path.join(...parts);
}

async function loadV8Models() {
  const baseDir = process.env.RPPG_V8_MODELS_DIR || './models/rppg_v8';
  const onnxDir = path.join(baseDir, 'onnx');
  const metaPath = path.join(baseDir, 'v8_training_metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.warn('[RppgV8ModelLoader] No v8_training_metadata.json found. Run export_v8_models.py first.');
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const loaded = {
    regression: {},
    risk: { classifiers: {}, regressors: {} },
    mood: {},
    metadata: meta,
  };

  for (const target of meta.regression_targets || []) {
    loaded.regression[target] = {};
    for (const algo of TARGET_ALGOS) {
      const onnxPath = safePath(onnxDir, `reg_${target}_${algo}.onnx`);
      if (fs.existsSync(onnxPath)) {
        loaded.regression[target][algo] = await ort.InferenceSession.create(onnxPath);
        console.log(`[RppgV8ModelLoader] reg/${target}/${algo}`);
      }
    }
  }

  const REGRESSOR_TTL_MS = 60_000;
  const loadTimes = {};
  const onnxDirRef = onnxDir;
  loaded.risk.loadRegressor = async function (domain) {
    const cached = this.regressors[domain];
    const loadedAt = loadTimes[domain];
    if (cached && cached !== 'lazy' && loadedAt && (Date.now() - loadedAt) < REGRESSOR_TTL_MS) {
      return cached;
    }
    if (cached && cached !== 'lazy') this.regressors[domain] = 'lazy';
    const regPath = safePath(onnxDirRef, `risk_${domain}_regressor.onnx`);
    if (fs.existsSync(regPath)) {
      this.regressors[domain] = await ort.InferenceSession.create(regPath);
      loadTimes[domain] = Date.now();
      console.log(`[RppgV8ModelLoader] lazy-loaded risk/${domain}/regressor`);
      return this.regressors[domain];
    }
    return null;
  };

  for (const domain of RISK_DOMAINS) {
    const regPath = safePath(onnxDir, `risk_${domain}_regressor.onnx`);
    const clfPath = safePath(onnxDir, `risk_${domain}_classifier.onnx`);

    if (fs.existsSync(regPath)) {
      loaded.risk.regressors[domain] = 'lazy';
    }
    if (fs.existsSync(clfPath)) {
      loaded.risk.classifiers[domain] = await ort.InferenceSession.create(clfPath);
      console.log(`[RppgV8ModelLoader] risk/${domain}/classifier`);
    }
  }

  for (const algo of MOOD_ALGOS) {
    const onnxPath = safePath(onnxDir, `mood_check_${algo}.onnx`);
    if (fs.existsSync(onnxPath)) {
      loaded.mood[algo] = await ort.InferenceSession.create(onnxPath);
      console.log(`[RppgV8ModelLoader] mood/${algo}`);
    }
  }

  v8Sessions = loaded;
  v8Meta = meta;

  const nReg = Object.values(loaded.regression).reduce((sum, t) => sum + Object.keys(t).length, 0);
  const nRiskClf = Object.keys(loaded.risk.classifiers).length;
  const nRiskLazy = Object.values(loaded.risk.regressors).filter(v => v === 'lazy').length;
  const nMood = Object.keys(loaded.mood).length;
  console.log(`[RppgV8ModelLoader] All v8 models ready — ${nReg} regression, ${nRiskClf} risk/clf + ${nRiskLazy} risk/reg (lazy), ${nMood} mood`);
}

function getV8Sessions() { return v8Sessions; }
function getV8Metadata() { return v8Meta; }

module.exports = { loadV8Models, getV8Sessions, getV8Metadata };
