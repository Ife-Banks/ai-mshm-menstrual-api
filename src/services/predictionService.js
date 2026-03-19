const ort = require('onnxruntime-node');
const { getSessions, getMetadata } = require('../loaders/modelLoader');

const DATASET_MEAN_CYCLE_LEN = 29.3;
const DATASET_MEAN_LUTEAL = 13.27;
const DEFAULT_FERTILITY_DAYS = 8.0;

function scaleFeatures(rawValues, mean, scale) {
  return rawValues.map((v, i) => (v - mean[i]) / scale[i]);
}

function getSeverity(score, bins, labels) {
  for (let i = 0; i < bins.length - 1; i++) {
    if (score > bins[i] && score <= bins[i + 1]) return labels[i];
  }
  return labels[labels.length - 1];
}

function deriveAndAggregate(cycles, rppgOvulationDay = null) {
  const n = cycles.length;
  const warnings = [];

  if (n === 1) {
    warnings.push('Only 1 cycle logged. CLV and luteal_std set to 0. mean_cycle_len uses dataset fallback.');
  }

  const derived = cycles.map((cycle, i) => {
    const startDate = new Date(cycle.period_start_date);
    const endDate   = new Date(cycle.period_end_date);

    const menses_len = Math.round((endDate - startDate) / 86400000);
    if (menses_len < 0) {
      throw new Error(`Invalid period dates: period_end_date must be after period_start_date for cycle ${i + 1}`);
    }

    const menses_score = cycle.bleeding_scores.reduce((a, b) => a + b, 0);

    let cycle_len = null;
    if (i > 0) {
      const prevStart = new Date(cycles[i - 1].period_start_date);
      cycle_len = Math.round((startDate - prevStart) / 86400000);
    }

    const ovulation_day = rppgOvulationDay !== null
      ? rppgOvulationDay
      : (cycle_len !== null ? cycle_len - 14 : null);

    let luteal_len = null;
    if (cycle_len !== null && ovulation_day !== null) {
      luteal_len = cycle_len - ovulation_day;
      if (luteal_len < 0) {
        luteal_len = 0;
        warnings.push(`Luteal phase clamped to 0 for cycle ${i + 1}`);
      }
    }

    let fertility_days = null;
    if (cycle_len !== null && ovulation_day !== null) {
      const fertileStart = Math.max(0, ovulation_day - 5);
      const fertileEnd = Math.min(cycle_len, ovulation_day + 1);
      fertility_days = Math.max(0, fertileEnd - fertileStart);
    }

    if (rppgOvulationDay !== null && cycle_len !== null && rppgOvulationDay > cycle_len) {
      warnings.push(`rPPG ovulation day ${rppgOvulationDay} exceeds cycle length ${cycle_len} for cycle ${i + 1}. Clamped.`);
    }

    return {
      cycle_len,
      menses_len,
      menses_score,
      luteal_len,
      fertility_days,
      peak: cycle.has_ovulation_peak ? 1 : 0,
      unusual: cycle.unusual_bleeding ? 1 : 0,
    };
  });

  const cycleLengths  = derived.map(d => d.cycle_len).filter(v => v !== null);
  const lutealLengths = derived.map(d => d.luteal_len).filter(v => v !== null);
  const fertileDays   = derived.map(d => d.fertility_days).filter(v => v !== null);

  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const std  = arr => {
    if (arr.length < 3) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  const mean_cycle_len = cycleLengths.length ? mean(cycleLengths) : DATASET_MEAN_CYCLE_LEN;
  const mean_luteal = lutealLengths.length ? mean(lutealLengths) : DATASET_MEAN_LUTEAL;
  const mean_fertility_days = fertileDays.length ? mean(fertileDays) : DEFAULT_FERTILITY_DAYS;

  return {
    derived_features: {
      CLV:                 parseFloat(std(cycleLengths).toFixed(4)),
      mean_cycle_len:      parseFloat(mean_cycle_len.toFixed(4)),
      mean_luteal:         parseFloat(mean_luteal.toFixed(4)),
      luteal_std:          parseFloat(std(lutealLengths).toFixed(4)),
      anovulatory_rate:    parseFloat((derived.filter(d => d.peak === 0).length / n).toFixed(4)),
      mean_menses_len:     parseFloat(mean(derived.map(d => d.menses_len)).toFixed(4)),
      mean_menses_score:   parseFloat(mean(derived.map(d => d.menses_score)).toFixed(4)),
      unusual_bleed_rate:  parseFloat((derived.filter(d => d.unusual === 1).length / n).toFixed(4)),
      mean_fertility_days: parseFloat(mean_fertility_days.toFixed(4)),
      n_cycles:            n,
    },
    warnings: warnings.length ? warnings : undefined
  };
}

async function predict(inputPayload) {
  const meta     = getMetadata();
  const sessions = getSessions();

  if (!sessions || !meta) {
    throw new Error('Models not yet loaded');
  }

  const {
    feature_names,
    diseases,
    flag_thresholds,
    severity_bins,
    severity_labels,
    scaler_mean,
    scaler_scale,
  } = meta;

  const rawVector = feature_names.map(name => {
    const val = inputPayload[name];
    if (val === undefined || val === null) {
      throw new Error(`Missing required feature: ${name}`);
    }
    return Number(val);
  });

  const scaled = scaleFeatures(rawVector, scaler_mean, scaler_scale);
  const tensor  = new ort.Tensor('float32', Float32Array.from(scaled), [1, scaled.length]);

  const results = {};

  for (const disease of diseases) {
    const clf = sessions.classifiers[disease];
    const reg = sessions.regressors[disease];

    const [clfOut] = Object.values(await clf.run({ float_input: tensor }));
    const [regOut] = Object.values(await reg.run({ float_input: tensor }));

    const probData = clfOut.data;
    const risk_probability = probData.length >= 2
      ? Number(probData[1].toFixed(4))
      : Number(probData[0].toFixed(4));

    const risk_score = Math.min(1, Math.max(0, Number(Number(regOut.data[0]).toFixed(4))));

    const threshold = flag_thresholds[disease];
    const risk_flag = risk_score >= threshold ? 1 : 0;
    const severity  = getSeverity(risk_score, severity_bins, severity_labels);

    results[disease] = {
      risk_probability,
      risk_score,
      risk_flag,
      severity,
      threshold_used: threshold,
    };
  }

  return {
    predictions: results,
    features_used: feature_names,
    model_module: meta.module,
  };
}

async function predictFromLogs(cycles, rppgOvulationDay = null) {
  const { derived_features, warnings } = deriveAndAggregate(cycles, rppgOvulationDay);
  const predictionResult = await predict(derived_features);
  
  return {
    ...predictionResult,
    derived_features,
    warnings
  };
}

async function savePredictionResult(userId, features, predictions, source) {
  const prisma = require('../db/prisma');
  const p = predictions;

  return prisma.predictionResult.create({
    data: {
      userId,

      featCLV:               features.CLV,
      featMeanCycleLen:      features.mean_cycle_len,
      featMeanLuteal:        features.mean_luteal,
      featLutealStd:         features.luteal_std,
      featAnovulatoryRate:   features.anovulatory_rate,
      featMeanMensesLen:     features.mean_menses_len,
      featMeanMensesScore:   features.mean_menses_score,
      featUnusualBleedRate:  features.unusual_bleed_rate,
      featMeanFertilityDays: features.mean_fertility_days,
      featNCycles:           features.n_cycles,

      infertilityRiskProb:  p.Infertility.risk_probability,
      infertilityRiskScore: p.Infertility.risk_score,
      infertilityRiskFlag:  p.Infertility.risk_flag,
      infertilitySeverity:  p.Infertility.severity,

      dysmenorrheaRiskProb:  p.Dysmenorrhea.risk_probability,
      dysmenorrheaRiskScore: p.Dysmenorrhea.risk_score,
      dysmenorrheaRiskFlag:  p.Dysmenorrhea.risk_flag,
      dysmenorrheaSeverity:  p.Dysmenorrhea.severity,

      pmddRiskProb:  p.PMDD.risk_probability,
      pmddRiskScore: p.PMDD.risk_score,
      pmddRiskFlag:  p.PMDD.risk_flag,
      pmddSeverity:  p.PMDD.severity,

      endometrialRiskProb:  p.Endometrial.risk_probability,
      endometrialRiskScore: p.Endometrial.risk_score,
      endometrialRiskFlag:  p.Endometrial.risk_flag,
      endometrialSeverity:  p.Endometrial.severity,

      t2dRiskProb:  p.T2D.risk_probability,
      t2dRiskScore: p.T2D.risk_score,
      t2dRiskFlag:  p.T2D.risk_flag,
      t2dSeverity:  p.T2D.severity,

      cvdRiskProb:  p.CVD.risk_probability,
      cvdRiskScore: p.CVD.risk_score,
      cvdRiskFlag:  p.CVD.risk_flag,
      cvdSeverity:  p.CVD.severity,

      nCyclesUsed:      features.n_cycles,
      predictionSource: source,
    },
  });
}

module.exports = { predict, predictFromLogs, deriveAndAggregate, savePredictionResult };
