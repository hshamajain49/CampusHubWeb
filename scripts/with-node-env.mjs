// Runs a command with NODE_ENV forced (cross-platform). Usage: node with-node-env.mjs <env> <command...>
// Needed because some shells export NODE_ENV=production globally, which breaks dev servers and tests.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [env, ...cmd] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bins = [path.join(process.cwd(), 'node_modules', '.bin'), path.join(root, 'node_modules', '.bin')];
const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
const PATH = [...bins, process.env[key] ?? ''].join(path.delimiter);
const child = spawn(cmd.join(' '), { stdio: 'inherit', shell: true, env: { ...process.env, [key]: PATH, NODE_ENV: env } });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
