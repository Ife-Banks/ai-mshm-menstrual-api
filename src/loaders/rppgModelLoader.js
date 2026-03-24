const ort  = require('onnxruntime-node');
const path = require('path');
const fs   = require('fs');

let rppgSessions = null;
let rppgMeta     = null;

async function loadRppgModels() {
  const dir = process.env.RPPG_MODELS_DIR || './models/onnx/rppg';
  const metaPath = path.join(dir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.warn('[RppgModelLoader] ⚠ No metadata.json found. Run `npm run convert:rppg` first.');
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const loaded = { classifiers: {}, regressors: {}, isolationForest: null };

  // Extract disease names from model_metrics (rPPG uses this instead of diseases field)
  const diseases = meta.diseases || Object.keys(meta.model_metrics || {});
  
  if (diseases.length === 0) {
    console.warn('[RppgModelLoader] ⚠ No disease categories found in metadata');
    return;
  }

  for (const disease of diseases) {
    const clfPath = path.join(dir, `${disease}_clf.onnx`);
    const regPath = path.join(dir, `${disease}_reg.onnx`);

    if (!fs.existsSync(clfPath) || !fs.existsSync(regPath)) {
      console.warn(`[RppgModelLoader] ⚠ Missing ONNX file(s) for ${disease}`);
      continue;
    }

    loaded.classifiers[disease] = await ort.InferenceSession.create(clfPath);
    loaded.regressors[disease] = await ort.InferenceSession.create(regPath);
    console.log(`[RppgModelLoader] ✓ Loaded ${disease}`);
  }

  const isoPath = path.join(dir, 'isolation_forest.onnx');
  if (fs.existsSync(isoPath)) {
    loaded.isolationForest = await ort.InferenceSession.create(isoPath);
    console.log('[RppgModelLoader] ✓ IsolationForest');
  } else {
    console.log('[RppgModelLoader] ⚠ IsolationForest ONNX not found — rule-based fallback active');
  }

  rppgSessions = loaded;
  rppgMeta     = meta;
  console.log('[RppgModelLoader] All rPPG models ready.');
}

function getRppgSessions() { return rppgSessions; }
function getRppgMetadata() { return rppgMeta; }

module.exports = { loadRppgModels, getRppgSessions, getRppgMetadata };
