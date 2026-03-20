-- Fix MoodDailyLog unique constraint: userId + logDate (not just logDate)
DROP INDEX IF EXISTS "MoodDailyLog_logDate_key";

CREATE UNIQUE INDEX "MoodDailyLog_userId_logDate_key" ON "MoodDailyLog"("userId", "logDate");
