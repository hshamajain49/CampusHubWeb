// Orphan sweep for complaint photos (COMPLAINT_REGISTRATION_SPEC.md §12.2 step 8, CD-12): deletes objects under
// complaints/ that are older than 24 h and referenced by no complaint_attachments row (left behind when an upload
// succeeded but its transaction and clean-up both failed). Defence in depth; run daily or by hand.
//   npm run storage:sweep -w @campushub/backend [-- --dry-run]
import { pool } from '../db/pool.js';
import { privateStore } from '../lib/storage.js';

const dryRun = process.argv.includes('--dry-run');
const cutoff = Date.now() - 24 * 3_600_000;

async function main() {
  const objects = await privateStore.list('complaints/');
  const old = objects.filter((o) => o.lastModified.getTime() < cutoff);
  if (!old.length) return console.log(`[sweep] ${objects.length} object(s), none older than 24 h`);
  const { rows } = await pool.query<{ key: string }>(
    `select storage_path as key from public.complaint_attachments where storage_path = any($1::text[])
     union
     select thumb_path from public.complaint_attachments where thumb_path = any($1::text[])`,
    [old.map((o) => o.key)],
  );
  const referenced = new Set(rows.map((r) => r.key));
  const orphans = old.map((o) => o.key).filter((k) => !referenced.has(k));
  console.log(`[sweep] ${objects.length} object(s), ${old.length} older than 24 h, ${orphans.length} orphaned`);
  if (!orphans.length || dryRun) return;
  for (let i = 0; i < orphans.length; i += 500) await privateStore.remove(orphans.slice(i, i + 500));
  console.log(`[sweep] deleted ${orphans.length} orphaned object(s)`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err?.message ?? err);
    await pool.end();
    process.exit(1);
  });
