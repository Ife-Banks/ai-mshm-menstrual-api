const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

// Connection pool configuration
// Adjust these based on your PostgreSQL max_connections and expected load
// For Neon (pgbouncer), also set NEON_DB_POOL_TIMEOUT in .env (default: 60s)
// to prevent pgbouncer from closing idle connections
// NOTE: these are reporting values only. Prisma's PrismaClient constructor
// rejects unknown options such as `min`/`max` (PrismaClientConstructorValidationError),
// so they must never be spread into `new PrismaClient({...})`. Prisma sizes its
// own pool — tune it from the connection string instead, e.g.
// DATABASE_URL="...?connection_limit=10&pool_timeout=20".
const poolConfig = {
  min: 2,                  // Minimum connections kept alive
  max: 10,                 // Maximum connections in pool - keeps pgbouncer load low
};
// NEON_DB_POOL_TIMEOUT=60 (in .env) sets pgbouncer stale connection timeout
// If using Neon, ensure this matches or exceeds your app's minimum session duration

try {
  const prisma = global.prisma || new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // Prevent multiple PrismaClient instances in development
  if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
  }

  // Connection event listeners for monitoring
  prisma.$connect().catch(err => {
    console.error('[Prisma] Failed to connect:', err.message);
  });

  prisma.$on('error', (e) => {
    console.error('[Prisma] Connection error:', e.message);
  });

  prisma.$on('warn', (e) => {
    console.warn('[Prisma] Connection warning:', e.message);
  });

  let acquiredConnections = 0;
const connectionHistory = [];

prisma.$on('acquire', (connection) => {
  acquiredConnections++;
  connectionHistory.push({
    timestamp: new Date().toISOString(),
    action: 'acquire',
    totalAcquired: acquiredConnections,
  });
  // Log warning if pool is getting close to limit
  if (acquiredConnections >= poolConfig.max * 0.8) {
    console.warn('[Prisma] Connection pool at 80% capacity:', acquiredConnections + '/' + poolConfig.max);
  }
});

prisma.$on('release', (connection) => {
  acquiredConnections = Math.max(0, acquiredConnections - 1);
  connectionHistory.push({
    timestamp: new Date().toISOString(),
    action: 'release',
    totalAcquired: acquiredConnections,
  });
});

// Export connection monitoring utilities
module.exports.getConnectionStats = () => ({
  acquiredConnections,
  poolMax: poolConfig.max,
  poolUsagePercentage: Math.round((acquiredConnections / poolConfig.max) * 100),
  totalAcquiredCount: connectionHistory.length,
  recentActivity: connectionHistory.slice(-10),
});

  module.exports = prisma;
} catch (initError) {
  console.error('[Prisma] Initialization failed:', initError.message);
  // Fallback: create minimal client for health check only
  const fallbackPrisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: ['error'],
  });
  module.exports = fallbackPrisma;
}