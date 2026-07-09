require('dotenv').config();
const { execSync } = require('child_process');
const { loadModels } = require('./src/loaders/modelLoader');
const { loadMoodModels } = require('./src/loaders/moodModelLoader');
const { loadRppgModels } = require('./src/loaders/rppgModelLoader');
const prisma = require('./src/db/prisma');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
const MAX_MIGRATE_RETRIES = 5;

async function runMigrations() {
  for (let attempt = 1; attempt <= MAX_MIGRATE_RETRIES; attempt++) {
    try {
      console.log(`[Migrate] Attempt ${attempt}/${MAX_MIGRATE_RETRIES} — running prisma migrate deploy...`);
      execSync('npx prisma migrate deploy', { stdio: 'inherit', timeout: 60000 });
      console.log('[Migrate] ✓ Migrations applied');
      return;
    } catch (err) {
      console.error(`[Migrate] ✗ Attempt ${attempt} failed: ${err.message}`);
      if (attempt === MAX_MIGRATE_RETRIES) throw err;
      const delay = attempt * 5000;
      console.log(`[Migrate] Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

(async () => {
  const startTime = Date.now();
  try {
    console.log('[Server] ─────────────────────────────────────────');
    console.log(`[Server] Starting AI-MSHM API — ${new Date().toISOString()}`);
    console.log(`[Server] Node version: ${process.version}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Server] Database URL: ${(process.env.DATABASE_URL || '').replace(/\/\/.*@/, '//***@')}`);
    console.log('[Server] ─────────────────────────────────────────');

    await runMigrations();

    console.log('[Server] Connecting to database...');
    await prisma.$connect();
    console.log(`[Server] ✓ Database connected (${Date.now() - startTime}ms)`);
    
    console.log('[Server] Loading menstrual ONNX models...');
    await loadModels();
    console.log('[Server] ✓ Menstrual models loaded');

    console.log('[Server] Loading mood ONNX models...');
    await loadMoodModels();
    console.log('[Server] ✓ Mood models loaded');

    console.log('[Server] Loading rPPG ONNX models...');
    await loadRppgModels();
    console.log('[Server] ✓ rPPG models loaded');

    app.listen(PORT, () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('[Server] ─────────────────────────────────────────');
      console.log(`[Server] ✓ Ready in ${elapsed}s`);
      console.log(`[Server] ✓ Listening on http://localhost:${PORT}`);
      console.log(`[Server] ✓ Swagger UI → http://localhost:${PORT}/api-docs`);
      console.log('[Server] ─────────────────────────────────────────');
    });
  } catch (err) {
    console.error('[Server] ✗ Fatal startup error:', err);
    console.error('[Server] ✗ Stack:', err.stack);
    process.exit(1);
  }
})();

process.on('SIGINT',  async () => {
  console.log('[Server] Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
