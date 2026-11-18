// Process lifecycle (§10.17).
import { config, integrations } from './config/env.js';
import { logger } from './lib/logger.js';
import { databaseHost, pool } from './db/pool.js';
import { createApp } from './app.js';
import { checkDemoData } from './lib/demo-guard.js';
import { sentinel } from './lib/sentinel.js';

const demo = await checkDemoData(pool, { nodeEnv: config.NODE_ENV, allowDemoData: config.ALLOW_DEMO_DATA });
if (demo.action === 'refuse') {
  logger.fatal(
    { demoAccounts: demo.demoAccounts, database: databaseHost },
    'Refusing to start: this production API is connected to a database with seeded @demo.edu accounts (their passwords are public). ' +
      'Point DATABASE_URL at the production branch, or set ALLOW_DEMO_DATA=true for a deliberate public demo.',
  );
  await pool.end().catch(() => undefined);
  process.exit(1);
}
if (demo.action === 'unchecked') logger.warn({ err: demo.error }, 'demo-data guard could not query the database');

// Monitoring (CampusHub Sentinel). Off unless SENTINEL_URL, SENTINEL_INGEST_KEY_ID and SENTINEL_INGEST_SECRET are set.
if (sentinel.configure()) sentinel.start();

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV, database: databaseHost, imageStore: config.IMAGE_STORE, integrations }, 'API listening');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => process.exit(0), 10_000);
  server.close(async () => {
    // Last events out (bounded by the client's own 3 s timeout); a Sentinel outage never delays shutdown further.
    sentinel.stop();
    await sentinel.flush().catch(() => undefined);
    await pool.end().catch(() => undefined);
    clearTimeout(timer);
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
