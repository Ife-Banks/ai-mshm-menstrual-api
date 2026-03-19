-- AlterTable
ALTER TABLE "PredictionResult" ADD COLUMN     "amenorrheaRiskTriggered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "criterion1Positive" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "irregularPatternTriggered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "oligomenorrheaTriggered" INTEGER NOT NULL DEFAULT 0;
