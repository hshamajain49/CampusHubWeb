// Process lifecycle (§10.17).
import { config, integrations } from './config/env.js';
import { logger } from './lib/logger.js';
import { databaseHost, pool } from './db/pool.js';
import { createApp } from './app.js';

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
