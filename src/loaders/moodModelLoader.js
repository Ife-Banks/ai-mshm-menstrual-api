const ort  = require('onnxruntime-node');
const path = require('path');
const fs   = require('fs');

let sessions = null;
let metadata = null;

async function loadMoodModels() {
  const dir  = process.env.MOOD_MODELS_DIR || './models/onnx/mood';
  const metaPath = path.join(dir, 'metadata.json');
  
  if (!fs.existsSync(metaPath)) {
    console.warn('[MoodModelLoader] ⚠ Mood models not found. Mood prediction endpoints will be unavailable.');
    console.warn('[MoodModelLoader] Run "npm run convert:mood" to generate ONNX models.');
    return;
  }
  
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  const loaded = { classifiers: {}, regressors: {} };

  for (const disease of meta.diseases) {
    const clfPath = path.join(dir, `${disease}_clf.onnx`);
    const regPath = path.join(dir, `${disease}_reg.onnx`);

    if (!fs.existsSync(clfPath) || !fs.existsSync(regPath)) {
      console.warn(`[MoodModelLoader] ⚠ Missing ONNX files for ${disease}`);
      continue;
    }

    loaded.classifiers[disease] = await ort.InferenceSession.create(clfPath);
    loaded.regressors[disease] = await ort.InferenceSession.create(regPath);
    console.log(`[MoodModelLoader] ✓ Loaded ${disease}`);
  }

  sessions = loaded;
  metadata = meta;
  console.log('[MoodModelLoader] Mood models ready.');
}

function getMoodSessions() { return sessions; }
function getMoodMetadata() { return metadata; }

module.exports = { loadMoodModels, getMoodSessions, getMoodMetadata };
