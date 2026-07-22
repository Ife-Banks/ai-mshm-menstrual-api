const ort = require('onnxruntime-node');
const path = require('path');
const fs = require('fs');

let v8Sessions = null;
let v8Meta = null;

const TARGET_ALGOS = [
  'LinearRegression',
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
  const nMood = Object.keys(loaded.mood).length;
  console.log(`[RppgV8ModelLoader] All v8 models ready — ${nReg} regression, ${nMood} mood`);
}

function getV8Sessions() { return v8Sessions; }
function getV8Metadata() { return v8Meta; }

module.exports = { loadV8Models, getV8Sessions, getV8Metadata };
