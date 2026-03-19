-- CreateTable
CREATE TABLE "MoodCognitiveLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phq4Item1" INTEGER NOT NULL,
    "phq4Item2" INTEGER NOT NULL,
    "phq4Item3" INTEGER NOT NULL,
    "phq4Item4" INTEGER NOT NULL,
    "affectValence" INTEGER NOT NULL,
    "affectArousal" INTEGER NOT NULL,
    "focusScore" INTEGER NOT NULL,
    "memoryScore" INTEGER NOT NULL,
    "mentalFatigue" INTEGER NOT NULL,
    "sleepQuality" DOUBLE PRECISION NOT NULL,
    "hoursSlept" DOUBLE PRECISION NOT NULL,
    "phq4AnxietyScore" INTEGER NOT NULL,
    "phq4DepressionScore" INTEGER NOT NULL,
    "phq4Total" INTEGER NOT NULL,
    "phq4AnxietyFlag" INTEGER NOT NULL,
    "phq4DepressionFlag" INTEGER NOT NULL,
    "cognitiveLoadScore" DOUBLE PRECISION NOT NULL,
    "sleepSatisfaction" DOUBLE PRECISION NOT NULL,
    "psychBurdenScore" DOUBLE PRECISION NOT NULL,
    "affectQuadrant" TEXT NOT NULL,
    "logDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cyclePhase" TEXT,

    CONSTRAINT "MoodCognitiveLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodPredictionResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nLogsUsed" INTEGER NOT NULL,
    "anxietyRiskScore" DOUBLE PRECISION,
    "anxietyRiskProb" DOUBLE PRECISION,
    "anxietyRiskFlag" INTEGER,
    "anxietySeverity" TEXT,
    "depressionRiskScore" DOUBLE PRECISION,
    "depressionRiskProb" DOUBLE PRECISION,
    "depressionRiskFlag" INTEGER,
    "depressionSeverity" TEXT,
    "pmddRiskScore" DOUBLE PRECISION,
    "pmddRiskProb" DOUBLE PRECISION,
    "pmddRiskFlag" INTEGER,
    "pmddSeverity" TEXT,
    "stressRiskScore" DOUBLE PRECISION,
    "stressRiskProb" DOUBLE PRECISION,
    "stressRiskFlag" INTEGER,
    "stressSeverity" TEXT,
    "cvdRiskScore" DOUBLE PRECISION,
    "cvdRiskProb" DOUBLE PRECISION,
    "cvdRiskFlag" INTEGER,
    "cvdSeverity" TEXT,
    "t2dRiskScore" DOUBLE PRECISION,
    "t2dRiskProb" DOUBLE PRECISION,
    "t2dRiskFlag" INTEGER,
    "t2dSeverity" TEXT,
    "infertilityRiskScore" DOUBLE PRECISION,
    "infertilityRiskProb" DOUBLE PRECISION,
    "infertilityRiskFlag" INTEGER,
    "infertilitySeverity" TEXT,
    "strokeRiskScore" DOUBLE PRECISION,
    "strokeRiskProb" DOUBLE PRECISION,
    "strokeRiskFlag" INTEGER,
    "strokeSeverity" TEXT,
    "metsynRiskScore" DOUBLE PRECISION,
    "metsynRiskProb" DOUBLE PRECISION,
    "metsynRiskFlag" INTEGER,
    "metsynSeverity" TEXT,

    CONSTRAINT "MoodPredictionResult_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MoodCognitiveLog" ADD CONSTRAINT "MoodCognitiveLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodPredictionResult" ADD CONSTRAINT "MoodPredictionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
