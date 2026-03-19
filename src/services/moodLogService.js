const prisma = require('../db/prisma');

const QUADRANT_MAP = {
  '1-1': 'Depressed-Fatigued',
  '1-2': 'Sad-Flat',
  '1-3': 'Anxious-Agitated',
  '2-1': 'Quiet-Neutral',
  '2-2': 'Neutral',
  '2-3': 'Alert-Neutral',
  '3-1': 'Content',
  '3-2': 'Calm-Relaxed',
  '3-3': 'Happy-Energised',
};

function deriveFields(input) {
  const phq4AnxietyScore    = input.phq4_item1 + input.phq4_item2;
  const phq4DepressionScore = input.phq4_item3 + input.phq4_item4;
  const phq4Total          = phq4AnxietyScore + phq4DepressionScore;
  const phq4AnxietyFlag     = phq4AnxietyScore >= 3 ? 1 : 0;
  const phq4DepressionFlag  = phq4DepressionScore >= 3 ? 1 : 0;

  const cogRaw             = (input.focus_score + input.memory_score + input.mental_fatigue) / 3;
  const cognitiveLoadScore = parseFloat(((cogRaw / 10) * 4 + 1).toFixed(4));

  const sleepSatisfaction  = parseFloat(((input.sleep_quality / 10) * 4 + 1).toFixed(4));

  const PHQ4_MAX = 12.0, COG_MAX = 5.0, SLEEP_MAX = 5.0;
  const phq4Norm  = phq4Total / PHQ4_MAX;
  const cogDef    = (COG_MAX - cognitiveLoadScore) / (COG_MAX - 1);
  const sleepDef  = (SLEEP_MAX - sleepSatisfaction) / (SLEEP_MAX - 1);
  const psychBurdenScore = parseFloat(
    Math.min(10, Math.max(0, (phq4Norm * 0.40 + cogDef * 0.35 + sleepDef * 0.25) * 10)).toFixed(4)
  );

  const affectQuadrant = QUADRANT_MAP[`${input.affect_valence}-${input.affect_arousal}`] || 'Neutral';

  return {
    phq4AnxietyScore,
    phq4DepressionScore,
    phq4Total,
    phq4AnxietyFlag,
    phq4DepressionFlag,
    cognitiveLoadScore,
    sleepSatisfaction,
    psychBurdenScore,
    affectQuadrant,
    affectValence: input.affect_valence,
    affectArousal: input.affect_arousal,
  };
}

async function saveMoodLog(userId, input, cyclePhase = null) {
  const derived = deriveFields(input);

  return prisma.moodCognitiveLog.create({
    data: {
      userId,
      phq4Item1: input.phq4_item1,
      phq4Item2: input.phq4_item2,
      phq4Item3: input.phq4_item3,
      phq4Item4: input.phq4_item4,
      affectValence: derived.affectValence,
      affectArousal: derived.affectArousal,
      focusScore: input.focus_score,
      memoryScore: input.memory_score,
      mentalFatigue: input.mental_fatigue,
      sleepQuality: input.sleep_quality,
      hoursSlept: input.hours_slept,
      phq4AnxietyScore: derived.phq4AnxietyScore,
      phq4DepressionScore: derived.phq4DepressionScore,
      phq4Total: derived.phq4Total,
      phq4AnxietyFlag: derived.phq4AnxietyFlag,
      phq4DepressionFlag: derived.phq4DepressionFlag,
      cognitiveLoadScore: derived.cognitiveLoadScore,
      sleepSatisfaction: derived.sleepSatisfaction,
      psychBurdenScore: derived.psychBurdenScore,
      affectQuadrant: derived.affectQuadrant,
      cyclePhase: cyclePhase || null,
    },
  });
}

async function getUserLogs(userId, limit = 30) {
  return prisma.moodCognitiveLog.findMany({
    where: { userId },
    orderBy: { logDate: 'desc' },
    take: limit,
  });
}

async function getAllUserLogs(userId) {
  return prisma.moodCognitiveLog.findMany({
    where: { userId },
    orderBy: { logDate: 'asc' },
  });
}

module.exports = { deriveFields, saveMoodLog, getUserLogs, getAllUserLogs };
