-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "bleedingScores" INTEGER[],
    "hasOvulationPeak" BOOLEAN NOT NULL,
    "unusualBleeding" BOOLEAN NOT NULL,
    "rppgOvulationDay" INTEGER,
    "cycleLength" INTEGER,
    "mensesLength" INTEGER NOT NULL,
    "totalMensesScore" INTEGER NOT NULL,
    "lutealLength" INTEGER,
    "fertilityDays" INTEGER,
    "ovulationDay" INTEGER,
    "cycleNumber" INTEGER NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featCLV" DOUBLE PRECISION NOT NULL,
    "featMeanCycleLen" DOUBLE PRECISION NOT NULL,
    "featMeanLuteal" DOUBLE PRECISION NOT NULL,
    "featLutealStd" DOUBLE PRECISION NOT NULL,
    "featAnovulatoryRate" DOUBLE PRECISION NOT NULL,
    "featMeanMensesLen" DOUBLE PRECISION NOT NULL,
    "featMeanMensesScore" DOUBLE PRECISION NOT NULL,
    "featUnusualBleedRate" DOUBLE PRECISION NOT NULL,
    "featMeanFertilityDays" DOUBLE PRECISION NOT NULL,
    "featNCycles" INTEGER NOT NULL,
    "infertilityRiskProb" DOUBLE PRECISION NOT NULL,
    "infertilityRiskScore" DOUBLE PRECISION NOT NULL,
    "infertilityRiskFlag" INTEGER NOT NULL,
    "infertilitySeverity" TEXT NOT NULL,
    "dysmenorrheaRiskProb" DOUBLE PRECISION NOT NULL,
    "dysmenorrheaRiskScore" DOUBLE PRECISION NOT NULL,
    "dysmenorrheaRiskFlag" INTEGER NOT NULL,
    "dysmenorrheaSeverity" TEXT NOT NULL,
    "pmddRiskProb" DOUBLE PRECISION NOT NULL,
    "pmddRiskScore" DOUBLE PRECISION NOT NULL,
    "pmddRiskFlag" INTEGER NOT NULL,
    "pmddSeverity" TEXT NOT NULL,
    "endometrialRiskProb" DOUBLE PRECISION NOT NULL,
    "endometrialRiskScore" DOUBLE PRECISION NOT NULL,
    "endometrialRiskFlag" INTEGER NOT NULL,
    "endometrialSeverity" TEXT NOT NULL,
    "t2dRiskProb" DOUBLE PRECISION NOT NULL,
    "t2dRiskScore" DOUBLE PRECISION NOT NULL,
    "t2dRiskFlag" INTEGER NOT NULL,
    "t2dSeverity" TEXT NOT NULL,
    "cvdRiskProb" DOUBLE PRECISION NOT NULL,
    "cvdRiskScore" DOUBLE PRECISION NOT NULL,
    "cvdRiskFlag" INTEGER NOT NULL,
    "cvdSeverity" TEXT NOT NULL,
    "nCyclesUsed" INTEGER NOT NULL,
    "predictionSource" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- AddForeignKey
ALTER TABLE "CycleLog" ADD CONSTRAINT "CycleLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionResult" ADD CONSTRAINT "PredictionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
