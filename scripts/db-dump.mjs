// Manual backup before production migrations (§11.7): pg_dump --format=custom to backups/<date>.dump.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? readEnvFile(path.join(root, 'backend', '.env')).DATABASE_URL;
const local = path.join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin', 'pg_dump.exe');
const bin = fs.existsSync(local) ? local : 'pg_dump';
fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
const file = path.join(root, 'backups', `${new Date().toISOString().slice(0, 10)}.dump`);
execFileSync(bin, ['--format=custom', url, '-f', file], { stdio: 'inherit' });
console.log(`[db:dump] wrote ${path.relative(root, file)}`);
