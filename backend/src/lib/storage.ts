// Private file storage for complaint photos (COMPLAINT_REGISTRATION_SPEC.md §12). Objects are never public:
// viewers get short-lived signed URLs from the API, which are never logged.
//   neon  Neon Object Storage, private bucket NEON_COMPLAINT_BUCKET (neon.ts); SigV4 presigned GET URLs.
//   fake  Local disk under .tmp/private-files, served by the API's /dev-files route with an HMAC-signed, expiring
//         query string (the same semantics as presigned URLs). Refused in production (env.ts).
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';
import { appError } from '../errors/app-error.js';
import { neonS3 } from './s3.js';

export const SIGNED_URL_SECONDS = 600;
const UPLOAD_TIMEOUT_MS = 15_000;

export interface SignedUrl {
  url: string;
  expiresAt: string;
}

export interface PrivateStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  signedUrls(keys: string[], seconds?: number): Promise<SignedUrl[]>;
  /** Objects under a prefix with their last-modified time (orphan sweep). */
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}

const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

// ─────────────────────────── Neon (S3, private bucket) ───────────────────────────
const neonStore: PrivateStore = {
  async put(key, body, contentType) {
    await neonS3().send(
      new PutObjectCommand({ Bucket: config.NEON_COMPLAINT_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=600' }),
      { abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) },
    );
  },
  async remove(keys) {
    if (!keys.length) return;
    await neonS3().send(
      new DeleteObjectsCommand({ Bucket: config.NEON_COMPLAINT_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
  },
  async signedUrls(keys, seconds = SIGNED_URL_SECONDS) {
    const at = expiresAt(seconds);
    return Promise.all(
      keys.map(async (Key) => ({
        url: await getSignedUrl(neonS3(), new GetObjectCommand({ Bucket: config.NEON_COMPLAINT_BUCKET, Key }), { expiresIn: seconds }),
        expiresAt: at,
      })),
    );
  },
  async list(prefix) {
    const out: { key: string; lastModified: Date }[] = [];
    let token: string | undefined;
    do {
      const page = await neonS3().send(
        new ListObjectsV2Command({ Bucket: config.NEON_COMPLAINT_BUCKET, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date() });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  },
};

// ─────────────────────────── fake (local disk, HMAC-signed URLs) ───────────────────────────
export const privateFilesDir = () => path.resolve(process.cwd(), '.tmp', 'private-files');
const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error(`unsafe storage key: ${key}`);
  return key;
};
const fakePath = (key: string) => path.join(privateFilesDir(), ...safeKey(key).split('/'));

function signature(key: string, expires: number): string {
  return createHmac('sha256', config.BETTER_AUTH_SECRET).update(`${key}\n${expires}`).digest('base64url');
}

/** Verifies a /dev-files request; returns the on-disk path or null (bad signature, expired, unsafe key). */
export function verifyFakeSignedUrl(key: string, expires: string | undefined, sig: string | undefined): string | null {
  const exp = Number(expires);
  if (!sig || !Number.isInteger(exp) || exp * 1000 < Date.now()) return null;
  try {
    const expected = Buffer.from(signature(key, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return fakePath(key);
  } catch {
    return null;
  }
}

const fakeStore: PrivateStore = {
  async put(key, body) {
    const file = fakePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  },
  async remove(keys) {
    await Promise.all(keys.map((k) => fs.rm(fakePath(k), { force: true })));
  },
  async signedUrls(keys, seconds = SIGNED_URL_SECONDS) {
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return keys.map((key) => ({
      url: `${config.BETTER_AUTH_URL}/dev-files/${safeKey(key)}?expires=${exp}&sig=${signature(key, exp)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    }));
  },
  async list(prefix) {
    const root = privateFilesDir();
    const out: { key: string; lastModified: Date }[] = [];
    async function walk(dir: string) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push({ key: path.relative(root, full).split(path.sep).join('/'), lastModified: (await fs.stat(full)).mtime });
      }
    }
    await walk(root);
    return out.filter((o) => o.key.startsWith(prefix));
  },
};

export const privateStore: PrivateStore = config.COMPLAINT_PHOTO_STORE === 'neon' ? neonStore : fakeStore;

/** Uploads several objects in parallel (max 6, §12.2 step 5); on any failure removes what was written → 502. */
export async function putAll(objects: { key: string; body: Buffer; contentType: string }[]): Promise<void> {
  // Wait for every upload to settle, so an object still in flight when another fails is cleaned up too.
  const results = await Promise.allSettled(objects.map((o) => privateStore.put(o.key, o.body, o.contentType)));
  if (results.every((r) => r.status === 'fulfilled')) return;
  const written = objects.filter((_, i) => results[i]!.status === 'fulfilled').map((o) => o.key);
  await privateStore.remove(written).catch(() => undefined);
  throw appError('STORAGE_ERROR');
}
