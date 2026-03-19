/*
  Warnings:

  - You are about to drop the `MoodCognitiveLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MoodCognitiveLog" DROP CONSTRAINT "MoodCognitiveLog_userId_fkey";

-- DropTable
DROP TABLE "MoodCognitiveLog";

-- CreateTable
CREATE TABLE "MoodDailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "logDate" TIMESTAMP(3) NOT NULL,
    "phq4Item1" INTEGER,
    "phq4Item2" INTEGER,
    "phq4Item3" INTEGER,
    "phq4Item4" INTEGER,
    "phq4AnxietyScore" INTEGER,
    "phq4DepressionScore" INTEGER,
    "phq4Total" INTEGER,
    "phq4AnxietyFlag" INTEGER,
    "phq4DepressionFlag" INTEGER,
    "affectValence" INTEGER,
    "affectArousal" INTEGER,
    "affectQuadrant" TEXT,
    "focusScore" INTEGER,
    "memoryScore" INTEGER,
    "mentalFatigue" INTEGER,
    "cognitiveLoadScore" DOUBLE PRECISION,
    "sleepQuality" DOUBLE PRECISION,
    "hoursSlept" DOUBLE PRECISION,
    "sleepSatisfaction" DOUBLE PRECISION,
    "psychBurdenScore" DOUBLE PRECISION,
    "cyclePhase" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoodDailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoodDailyLog_logDate_key" ON "MoodDailyLog"("logDate");

-- AddForeignKey
ALTER TABLE "MoodDailyLog" ADD CONSTRAINT "MoodDailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
