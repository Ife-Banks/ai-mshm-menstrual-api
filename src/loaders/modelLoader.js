const ort  = require('onnxruntime-node');
const path = require('path');
const fs   = require('fs');

let sessions  = null;
let metadata  = null;

async function loadModels() {
  const dir  = process.env.MODELS_DIR || './models/onnx';
  
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Metadata file not found at ${metaPath}. Run 'npm run convert' first.`);
  }
  
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const DISEASES = meta.diseases;
  const loaded   = { classifiers: {}, regressors: {} };

  for (const disease of DISEASES) {
    const clfPath = path.join(dir, `${disease}_clf.onnx`);
    const regPath = path.join(dir, `${disease}_reg.onnx`);

    if (!fs.existsSync(clfPath)) {
      throw new Error(`Classifier model not found: ${clfPath}. Run 'npm run convert' first.`);
    }
    if (!fs.existsSync(regPath)) {
      throw new Error(`Regressor model not found: ${regPath}. Run 'npm run convert' first.`);
    }

    loaded.classifiers[disease] = await ort.InferenceSession.create(clfPath);
    loaded.regressors[disease]  = await ort.InferenceSession.create(regPath);
    console.log(`[ModelLoader] ✓ Loaded ${disease}`);
  }

  sessions = loaded;
  metadata = meta;
  console.log('[ModelLoader] All models ready.');
}

function getSessions()  { return sessions; }
function getMetadata()  { return metadata; }

module.exports = { loadModels, getSessions, getMetadata };
