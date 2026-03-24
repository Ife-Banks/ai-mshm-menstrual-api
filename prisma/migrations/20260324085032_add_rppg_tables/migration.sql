-- CreateTable
CREATE TABLE "RppgSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rmssd" DOUBLE PRECISION NOT NULL,
    "meanTemp" DOUBLE PRECISION NOT NULL,
    "meanEda" DOUBLE PRECISION NOT NULL,
    "asi" DOUBLE PRECISION,
    "sessionType" TEXT NOT NULL DEFAULT 'checkin',
    "sessionQuality" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RppgSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RppgPredictionResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nSessionsUsed" INTEGER NOT NULL,
    "rmssdMean" DOUBLE PRECISION NOT NULL,
    "rmssdMin" DOUBLE PRECISION NOT NULL,
    "rmssdStd" DOUBLE PRECISION NOT NULL,
    "tempMean" DOUBLE PRECISION NOT NULL,
    "tempStd" DOUBLE PRECISION NOT NULL,
    "edaMean" DOUBLE PRECISION NOT NULL,
    "edaMax" DOUBLE PRECISION NOT NULL,
    "edaStd" DOUBLE PRECISION NOT NULL,
    "lowRmssdFlag" INTEGER NOT NULL,
    "modLowRmssdFlag" INTEGER NOT NULL,
    "highEdaFlag" INTEGER NOT NULL,
    "highAsiFlag" INTEGER,
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
    "metabolicRiskScore" DOUBLE PRECISION,
    "metabolicRiskProb" DOUBLE PRECISION,
    "metabolicRiskFlag" INTEGER,
    "metabolicSeverity" TEXT,
    "heartFailureRiskScore" DOUBLE PRECISION,
    "heartFailureRiskProb" DOUBLE PRECISION,
    "heartFailureRiskFlag" INTEGER,
    "heartFailureSeverity" TEXT,
    "infertilityRiskScore" DOUBLE PRECISION,
    "infertilityRiskProb" DOUBLE PRECISION,
    "infertilityRiskFlag" INTEGER,
    "infertilitySeverity" TEXT,
    "anomalyFlag" INTEGER,
    "anomalyScore" DOUBLE PRECISION,

    CONSTRAINT "RppgPredictionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RppgSessionPredictions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RppgSessionPredictions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_RppgSessionPredictions_B_index" ON "_RppgSessionPredictions"("B");

-- AddForeignKey
ALTER TABLE "RppgSession" ADD CONSTRAINT "RppgSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RppgPredictionResult" ADD CONSTRAINT "RppgPredictionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RppgSessionPredictions" ADD CONSTRAINT "_RppgSessionPredictions_A_fkey" FOREIGN KEY ("A") REFERENCES "RppgPredictionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RppgSessionPredictions" ADD CONSTRAINT "_RppgSessionPredictions_B_fkey" FOREIGN KEY ("B") REFERENCES "RppgSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
