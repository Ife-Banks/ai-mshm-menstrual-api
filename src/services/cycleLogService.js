const prisma = require('../db/prisma');

async function saveCycleLog(userId, cycleData, rppgOvulationDay = null) {
  const {
    period_start_date,
    period_end_date,
    bleeding_scores,
    has_ovulation_peak,
    unusual_bleeding,
  } = cycleData;

  const startDate = new Date(period_start_date);
  const endDate   = new Date(period_end_date);

  const mensesLength     = Math.round((endDate - startDate) / 86400000);
  const totalMensesScore = bleeding_scores.reduce((a, b) => a + b, 0);

  const previousCycle = await prisma.cycleLog.findFirst({
    where: { userId },
    orderBy: { periodStartDate: 'desc' },
  });

  let cycleLength   = null;
  let ovulationDay  = null;
  let lutealLength  = null;
  let fertilityDays = null;
  let cycleNumber   = 1;

  if (previousCycle) {
    cycleNumber  = previousCycle.cycleNumber + 1;
    cycleLength  = Math.round((startDate - previousCycle.periodStartDate) / 86400000);
    ovulationDay = rppgOvulationDay ?? (cycleLength - 14);
    lutealLength = Math.max(0, cycleLength - ovulationDay);
    fertilityDays = Math.max(
      0,
      Math.min(ovulationDay + 1, cycleLength) - Math.max(0, ovulationDay - 5)
    );
  }

  const saved = await prisma.cycleLog.create({
    data: {
      userId,
      periodStartDate:  startDate,
      periodEndDate:    endDate,
      bleedingScores:   bleeding_scores,
      hasOvulationPeak: has_ovulation_peak,
      unusualBleeding:  unusual_bleeding,
      rppgOvulationDay: rppgOvulationDay ?? null,
      cycleLength,
      mensesLength,
      totalMensesScore,
      lutealLength,
      fertilityDays,
      ovulationDay,
      cycleNumber,
    },
  });

  return saved;
}

async function getUserCycles(userId) {
  return prisma.cycleLog.findMany({
    where: { userId },
    orderBy: { periodStartDate: 'asc' },
  });
}

function aggregateFromStoredCycles(cycles) {
  const n = cycles.length;
  if (n === 0) throw new Error('No cycles found for this user');

  const mean = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : 0;

  const std = arr => {
    if (arr.length < 3) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  const cycleLengths   = cycles.map(c => c.cycleLength).filter(v => v !== null);
  const lutealLengths = cycles.map(c => c.lutealLength).filter(v => v !== null);
  const fertileDays   = cycles.map(c => c.fertilityDays).filter(v => v !== null);

  return {
    CLV:                 parseFloat(std(cycleLengths).toFixed(4)),
    mean_cycle_len:      parseFloat((mean(cycleLengths) || 29.3).toFixed(4)),
    mean_luteal:         parseFloat((mean(lutealLengths) || 13.27).toFixed(4)),
    luteal_std:          parseFloat(std(lutealLengths).toFixed(4)),
    anovulatory_rate:    parseFloat(
      (cycles.filter(c => !c.hasOvulationPeak).length / n).toFixed(4)
    ),
    mean_menses_len:     parseFloat(mean(cycles.map(c => c.mensesLength)).toFixed(4)),
    mean_menses_score:   parseFloat(mean(cycles.map(c => c.totalMensesScore)).toFixed(4)),
    unusual_bleed_rate:  parseFloat(
      (cycles.filter(c => c.unusualBleeding).length / n).toFixed(4)
    ),
    mean_fertility_days: parseFloat((mean(fertileDays) || 8.0).toFixed(4)),
    n_cycles:            n,
  };
}

module.exports = { saveCycleLog, getUserCycles, aggregateFromStoredCycles };
