require('dotenv').config();
const { loadModels } = require('./src/loaders/modelLoader');
const prisma = require('./src/db/prisma');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    console.log('[Server] Loading ONNX models...');
    await loadModels();
    
    app.listen(PORT, () => {
      console.log(`[Server] ✓ Running on http://localhost:${PORT}`);
      console.log(`[Server] ✓ Swagger UI → http://localhost:${PORT}/api-docs`);
      console.log(`[Server] ✓ Database connected`);
    });
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
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
