// Photo handling around complaint transactions (COMPLAINT_REGISTRATION_SPEC.md §12.2, CG-05): process and upload
// BEFORE the transaction, insert attachment rows INSIDE it, and remove the objects if it fails.
import { randomUUID } from 'node:crypto';
import type { AttachmentKind } from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';
import { processPhoto } from '../../lib/images.js';
import { logger } from '../../lib/logger.js';
import { privateStore, putAll } from '../../lib/storage.js';

export interface PreparedPhoto {
  id: string;
  storagePath: string;
  thumbPath: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface PreparedPhotos {
  photos: PreparedPhoto[];
  keys: string[];
}

export const NO_PHOTOS: PreparedPhotos = { photos: [], keys: [] };

/** Validates by decoding, re-encodes to WebP (full + thumb) and uploads under complaints/{complaintId}/. */
export async function preparePhotos(complaintId: string, files: { buffer: Buffer; name: string }[]): Promise<PreparedPhotos> {
  if (!files.length) return NO_PHOTOS;
  const processed = await Promise.all(files.map((f) => processPhoto(f.buffer, f.name)));
  const photos: PreparedPhoto[] = [];
  const objects: { key: string; body: Buffer; contentType: string }[] = [];
  for (const p of processed) {
    const id = randomUUID();
    const storagePath = `complaints/${complaintId}/${id}.webp`;
    const thumbPath = `complaints/${complaintId}/${id}_thumb.webp`;
    photos.push({ id, storagePath, thumbPath, sizeBytes: p.full.size, width: p.full.width, height: p.full.height });
    objects.push({ key: storagePath, body: p.full.body, contentType: 'image/webp' }, { key: thumbPath, body: p.thumb.body, contentType: 'image/webp' });
  }
  await putAll(objects); // 502 STORAGE_ERROR, with its own clean-up
  return { photos, keys: objects.map((o) => o.key) };
}

export async function insertAttachments(
  tx: DbClient,
  complaintId: string,
  kind: AttachmentKind,
  prepared: PreparedPhotos,
  uploadedBy: string,
): Promise<void> {
  for (const p of prepared.photos) {
    await tx.query(
      `insert into public.complaint_attachments (id, complaint_id, kind, storage_path, thumb_path, size_bytes, width, height, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, complaintId, kind, p.storagePath, p.thumbPath, p.sizeBytes, p.width, p.height, uploadedBy],
    );
  }
}

/** Best-effort removal after a failed transaction; failures are logged with the keys for the orphan sweep (§12.2.6). */
export async function discardPhotos(prepared: PreparedPhotos): Promise<void> {
  if (!prepared.keys.length) return;
  try {
    await privateStore.remove(prepared.keys);
  } catch (err) {
    logger.error({ err, keys: prepared.keys }, 'complaint photo clean-up failed');
  }
}
