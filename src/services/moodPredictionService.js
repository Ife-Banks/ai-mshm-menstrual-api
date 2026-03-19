const ort = require('onnxruntime-node');
const { getMoodSessions, getMoodMetadata } = require('../loaders/moodModelLoader');
const prisma = require('../db/prisma');
const { getAllUserLogs } = require('./moodLogService');

const QUADRANT_SCORE = {
  'Calm-Relaxed': 1, 'Happy-Energised': 2, 'Content': 3,
  'Quiet-Neutral': 4, 'Neutral': 4, 'Alert-Neutral': 5,
  'Sad-Flat': 6, 'Depressed-Fatigued': 7, 'Anxious-Agitated': 8,
};

const FEATURE_FALLBACKS = {
  phq4_anx:           1.5,
  phq4_dep:           1.5,
  phq4_tot:           3.0,
  cog:                3.27,
  sleep:              3.8,
  hours_slept:        7.0,
  affect_valence:     5.0,
  affect_arousal:     5.0,
  affect_quadrant_score: 4.0,
  pbs:                0.0,
  anx_flag:           0.0,
  dep_flag:           0.0,
};

function getSeverity(score, bins, labels) {
  for (let i = 0; i < bins.length - 1; i++) {
    if (score > bins[i] && score <= bins[i + 1]) return labels[i];
  }
  return labels[labels.length - 1];
}

const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;

const orFallback = (val, key) => val ?? FEATURE_FALLBACKS[key] ?? 0;

const std = arr => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/(arr.length-1));
};

const slope = arr => {
  if (arr.length < 3) return 0;
  const n = arr.length;
  const xs = Array.from({length:n},(_,i)=>i);
  const mx = mean(xs), my = mean(arr);
  const num = xs.reduce((s,x,i)=>s+(x-mx)*(arr[i]-my),0);
  const den = xs.reduce((s,x)=>s+(x-mx)**2,0);
  return den === 0 ? 0 : num/den;
};

const quadScore = q => QUADRANT_SCORE[q] ?? 4;

const phaseMean = (logs, phase, key) => {
  const vals = logs.filter(r => r.cyclePhase === phase).map(r => r[key]).filter(v => v !== null && v !== undefined);
  return vals.length > 0 ? mean(vals) : null;
};

async function buildFeatureVector(userId) {
  const logs = await getAllUserLogs(userId);
  
  if (logs.length < 3) {
    throw new Error('INSUFFICIENT_DATA');
  }

  const meta = getMoodMetadata();
  const medians = meta?.feature_medians || {};

  const orMedian = (val, key) => val ?? medians[key] ?? FEATURE_FALLBACKS[key] ?? 0;

  const phq4Anx   = logs.map(r => r.phq4AnxietyScore);
  const phq4Dep   = logs.map(r => r.phq4DepressionScore);
  const phq4Tot   = logs.map(r => r.phq4Total);
  const cog       = logs.map(r => r.cognitiveLoadScore);
  const sleep     = logs.map(r => r.sleepSatisfaction);
  const val       = logs.map(r => r.affectValence);
  const aro       = logs.map(r => r.affectArousal);
  const quad      = logs.map(r => quadScore(r.affectQuadrant));
  const pbs       = logs.map(r => r.psychBurdenScore);
  const anxFlag   = logs.map(r => r.phq4AnxietyFlag);
  const depFlag   = logs.map(r => r.phq4DepressionFlag);

  const phq4_anx_28d   = orFallback(mean(phq4Anx),   'phq4_anx');
  const phq4_dep_28d   = orFallback(mean(phq4Dep),   'phq4_dep');
  const phq4_total_28d = orFallback(mean(phq4Tot),   'phq4_tot');
  const cog_28d        = orFallback(mean(cog),        'cog');
  const sleep_28d      = orFallback(mean(sleep),      'sleep');
  const val_28d        = orFallback(mean(val),        'affect_valence');
  const aro_28d        = orFallback(mean(aro),        'affect_arousal');
  const quad_28d       = orFallback(mean(quad),       'affect_quadrant_score');
  const pbs_28d        = orFallback(mean(pbs),        'pbs');

  const anx_flag_pct = orFallback(mean(anxFlag), 'anx_flag');
  const dep_flag_pct = orFallback(mean(depFlag), 'dep_flag');

  const phq4_lut  = orMedian(phaseMean(logs, 'Luteal',    'phq4Total'),           'phq4_lut');
  const phq4_fol  = orMedian(phaseMean(logs, 'Follicular','phq4Total'),           'phq4_fol');
  const phq4_men  = orMedian(phaseMean(logs, 'Menstrual', 'phq4Total'),           'phq4_men');
  const anx_lut   = orMedian(phaseMean(logs, 'Luteal',    'phq4AnxietyScore'),    'anx_lut');
  const anx_fol   = orMedian(phaseMean(logs, 'Follicular','phq4AnxietyScore'),    'anx_fol');
  const dep_lut   = orMedian(phaseMean(logs, 'Luteal',    'phq4DepressionScore'), 'dep_lut');
  const dep_fol   = orMedian(phaseMean(logs, 'Follicular','phq4DepressionScore'), 'dep_fol');
  const cog_lut   = orMedian(phaseMean(logs, 'Luteal',    'cognitiveLoadScore'),  'cog_lut');
  const cog_fol   = orMedian(phaseMean(logs, 'Follicular','cognitiveLoadScore'),  'cog_fol');
  const cog_men   = orMedian(phaseMean(logs, 'Menstrual', 'cognitiveLoadScore'),  'cog_men');
  const sleep_lut = orMedian(phaseMean(logs, 'Luteal',    'sleepSatisfaction'),   'sleep_lut');
  const sleep_fol = orMedian(phaseMean(logs, 'Follicular','sleepSatisfaction'),  'sleep_fol');
  const sleep_men = orMedian(phaseMean(logs, 'Menstrual', 'sleepSatisfaction'),  'sleep_men');
  const pbs_lut  = orMedian(phaseMean(logs, 'Luteal',    'psychBurdenScore'),    'pbs_lut');
  const pbs_fol  = orMedian(phaseMean(logs, 'Follicular','psychBurdenScore'),   'pbs_fol');

  const phq4_delta     = phq4_lut - phq4_fol;
  const anx_delta      = anx_lut  - anx_fol;
  const dep_delta     = dep_lut  - dep_fol;
  const cog_drop_delta = cog_fol  - cog_lut;
  const sleep_delta   = sleep_lut - sleep_fol;
  const pbs_delta     = pbs_lut  - pbs_fol;

  const phq4_slope  = slope(phq4Tot);
  const cog_slope   = slope(cog);
  const sleep_slope = slope(sleep);
  const pbs_slope  = slope(pbs);

  const phq4_std = std(phq4Tot);
  const cog_std  = std(cog);

  const Anxiety_Flag          = phq4_anx_28d   >= 3.0 ? 1 : 0;
  const Depression_Flag      = phq4_dep_28d   >= 3.0 ? 1 : 0;
  const Combined_MH_Flag      = phq4_total_28d >= 6.0 ? 1 : 0;
  const Low_Sleep_Flag       = sleep_28d       <= 2.5 ? 1 : 0;
  const Low_Cog_Flag        = cog_28d         <= 2.5 ? 1 : 0;
  const Rising_PHQ4_Flag     = phq4_slope       > 0.08 ? 1 : 0;
  const PMDD_Mood_Flag       = (phq4_delta > 3.0 && cog_drop_delta > 1.0 && Math.abs(sleep_delta) > 0.5) ? 1 : 0;
  const Anxious_Agitated_Flag= aro_28d          >= 2.5 ? 1 : 0;
  const High_PBS_Flag        = pbs_28d          >= 5.0 ? 1 : 0;

  return [
    phq4_anx_28d, phq4_dep_28d, phq4_total_28d,
    cog_28d, sleep_28d, val_28d, aro_28d, quad_28d, pbs_28d,
    anx_flag_pct, dep_flag_pct,
    phq4_lut, phq4_fol, phq4_men,
    anx_lut, anx_fol, dep_lut, dep_fol,
    cog_lut, cog_fol, cog_men,
    sleep_lut, sleep_fol, sleep_men,
    pbs_lut, pbs_fol,
    phq4_delta, anx_delta, dep_delta,
    cog_drop_delta, sleep_delta, pbs_delta,
    phq4_slope, cog_slope, sleep_slope, pbs_slope,
    phq4_std, cog_std,
    Anxiety_Flag, Depression_Flag, Combined_MH_Flag,
    Low_Sleep_Flag, Low_Cog_Flag, Rising_PHQ4_Flag,
    PMDD_Mood_Flag, Anxious_Agitated_Flag, High_PBS_Flag,
  ];
}

async function runDiseasePredictions(featureVector, diseaseList) {
  const sessions = getMoodSessions();
  const meta     = getMoodMetadata();
  const results  = {};

  const tensor = new ort.Tensor(
    'float32',
    Float32Array.from(featureVector),
    [1, featureVector.length]
  );

  for (const disease of diseaseList) {
    if (!sessions.classifiers[disease]) continue;
    
    const clf = sessions.classifiers[disease];
    const reg = sessions.regressors[disease];

    const [clfOut] = Object.values(await clf.run({ float_input: tensor }));
    const [regOut] = Object.values(await reg.run({ float_input: tensor }));

    const probData = clfOut.data;
    const risk_probability = probData.length >= 2
      ? parseFloat(Number(probData[1]).toFixed(4))
      : parseFloat(Number(probData[0]).toFixed(4));

    const risk_score = Math.min(1, Math.max(0,
      parseFloat(Number(regOut.data[0]).toFixed(4))
    ));

    const threshold  = meta?.flag_thresholds[disease] || 0.5;
    const risk_flag  = risk_score >= threshold ? 1 : 0;
    const severity   = getSeverity(risk_score, meta?.severity_bins || [0, 0.2, 0.4, 0.6, 0.8, 1], meta?.severity_labels || ['Minimal', 'Mild', 'Moderate', 'Severe', 'Extreme']);
    const weight     = meta?.layer_weights[disease] || 1.0;

    results[disease] = {
      risk_probability,
      risk_score,
      risk_flag,
      severity,
      threshold_used:        threshold,
      layer_weight:        weight,
      weighted_contribution: parseFloat((risk_score * weight).toFixed(4)),
      description:           meta?.descriptions[disease] || '',
    };
  }

  return results;
}

async function saveMoodPrediction(userId, group, diseaseResults, nLogsUsed) {
  const data = {
    userId,
    group,
    nLogsUsed,
    anxietyRiskScore:  diseaseResults.Anxiety?.risk_score,
    anxietyRiskProb:   diseaseResults.Anxiety?.risk_probability,
    anxietyRiskFlag:   diseaseResults.Anxiety?.risk_flag,
    anxietySeverity:   diseaseResults.Anxiety?.severity,
    depressionRiskScore:  diseaseResults.Depression?.risk_score,
    depressionRiskProb:   diseaseResults.Depression?.risk_probability,
    depressionRiskFlag:   diseaseResults.Depression?.risk_flag,
    depressionSeverity:   diseaseResults.Depression?.severity,
    pmddRiskScore:  diseaseResults.PMDD?.risk_score,
    pmddRiskProb:   diseaseResults.PMDD?.risk_probability,
    pmddRiskFlag:   diseaseResults.PMDD?.risk_flag,
    pmddSeverity:   diseaseResults.PMDD?.severity,
    stressRiskScore:  diseaseResults.ChronicStress?.risk_score,
    stressRiskProb:   diseaseResults.ChronicStress?.risk_probability,
    stressRiskFlag:   diseaseResults.ChronicStress?.risk_flag,
    stressSeverity:   diseaseResults.ChronicStress?.severity,
    cvdRiskScore:  diseaseResults.CVD_Mood?.risk_score,
    cvdRiskProb:   diseaseResults.CVD_Mood?.risk_probability,
    cvdRiskFlag:   diseaseResults.CVD_Mood?.risk_flag,
    cvdSeverity:   diseaseResults.CVD_Mood?.severity,
    t2dRiskScore:  diseaseResults.T2D_Mood?.risk_score,
    t2dRiskProb:   diseaseResults.T2D_Mood?.risk_probability,
    t2dRiskFlag:   diseaseResults.T2D_Mood?.risk_flag,
    t2dSeverity:   diseaseResults.T2D_Mood?.severity,
    infertilityRiskScore:  diseaseResults.Infertility_Mood?.risk_score,
    infertilityRiskProb:   diseaseResults.Infertility_Mood?.risk_probability,
    infertilityRiskFlag:   diseaseResults.Infertility_Mood?.risk_flag,
    infertilitySeverity:   diseaseResults.Infertility_Mood?.severity,
    strokeRiskScore:  diseaseResults.Stroke_Mood?.risk_score,
    strokeRiskProb:   diseaseResults.Stroke_Mood?.risk_probability,
    strokeRiskFlag:   diseaseResults.Stroke_Mood?.risk_flag,
    strokeSeverity:   diseaseResults.Stroke_Mood?.severity,
    metsynRiskScore:  diseaseResults.MetSyn_Mood?.risk_score,
    metsynRiskProb:   diseaseResults.MetSyn_Mood?.risk_probability,
    metsynRiskFlag:   diseaseResults.MetSyn_Mood?.risk_flag,
    metsynSeverity:   diseaseResults.MetSyn_Mood?.severity,
  };

  return prisma.moodPredictionResult.create({ data });
}

module.exports = { buildFeatureVector, runDiseasePredictions, saveMoodPrediction };
