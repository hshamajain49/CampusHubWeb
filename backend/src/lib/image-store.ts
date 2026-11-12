// Venue photo storage (§10.19). Three interchangeable stores, picked by IMAGE_STORE:
//   neon        Neon Object Storage (S3-compatible, public-read bucket declared in neon.ts). The API resizes with sharp
//               and writes two immutable, versioned keys: venues/<venueId>/<uuid>.webp (1200×675) and …-thumb.webp
//               (640×360). image_url holds the main object's URL; image_public_id holds the key without extension.
//   cloudinary  Cloudinary upload + delivery-time transformations (kept as an alternative).
//   fake        Bytes on local disk, served by the API's /dev-images route. Refused in production (env.ts).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { appError } from '../errors/app-error.js';
import { neonS3 } from './s3.js';

export interface StoredImage {
  secureUrl: string;
  publicId: string;
}

export interface ImageStore {
  upload(venueId: string, buffer: Buffer): Promise<StoredImage>;
  destroy(publicId: string): Promise<void>;
}

const UPLOAD_TIMEOUT_MS = 30_000;

// ─────────────────────────── fake (local disk) ───────────────────────────
const FAKE_HOST = 'https://fake-images.campushub.invalid/';
const fakeDir = () => path.resolve(process.cwd(), '.tmp', 'images');

const fakeStore: ImageStore = {
  async upload(venueId, buffer) {
    await fs.mkdir(fakeDir(), { recursive: true });
    const version = Date.now();
    await fs.writeFile(path.join(fakeDir(), venueId), buffer);
    return { secureUrl: `${FAKE_HOST}v${version}/${venueId}`, publicId: `${config.CLOUDINARY_FOLDER}/${venueId}` };
  },
  async destroy(publicId) {
    await fs.rm(path.join(fakeDir(), path.basename(publicId)), { force: true });
  },
};

// ─────────────────────────── Neon Object Storage ───────────────────────────
// Same framing Cloudinary produced with c_fill,g_auto: cover-crop around the most salient region.
const RENDITIONS = [
  { suffix: '', width: 1200, height: 675, quality: 82 },
  { suffix: '-thumb', width: 640, height: 360, quality: 78 },
] as const;
const IMMUTABLE = 'public, max-age=31536000, immutable';

const neonObjectUrl = (key: string) => `${config.AWS_ENDPOINT_URL_S3!.replace(/\/+$/, '')}/${config.NEON_STORAGE_BUCKET}/${key}`;

async function render(buffer: Buffer) {
  try {
    // rotate() applies EXIF orientation; metadata (GPS etc.) is stripped by default.
    return await Promise.all(
      RENDITIONS.map(async (r) => ({
        suffix: r.suffix,
        body: await sharp(buffer, { failOn: 'error' })
          .rotate()
          .resize(r.width, r.height, { fit: 'cover', position: sharp.strategy.attention })
          .webp({ quality: r.quality })
          .toBuffer(),
      })),
    );
  } catch {
    throw appError('IMAGE_INVALID'); // not a decodable JPEG/PNG/WebP despite its MIME type
  }
}

const neonStore: ImageStore = {
  async upload(venueId, buffer) {
    const renditions = await render(buffer);
    // A new key per upload: caches never serve a stale photo, and a failed DB update can't clobber the current one.
    const base = `venues/${venueId}/${randomUUID()}`;
    const signal = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
    try {
      await Promise.all(
        renditions.map((r) =>
          neonS3().send(
            new PutObjectCommand({
              Bucket: config.NEON_STORAGE_BUCKET,
              Key: `${base}${r.suffix}.webp`,
              Body: r.body,
              ContentType: 'image/webp',
              CacheControl: IMMUTABLE,
            }),
            { abortSignal: signal },
          ),
        ),
      );
    } catch {
      await neonStore.destroy(base).catch(() => undefined);
      throw appError('UPSTREAM_ERROR');
    }
    return { secureUrl: neonObjectUrl(`${base}.webp`), publicId: base };
  },
  async destroy(publicId) {
    await Promise.all(
      RENDITIONS.map((r) =>
        neonS3().send(new DeleteObjectCommand({ Bucket: config.NEON_STORAGE_BUCKET, Key: `${publicId}${r.suffix}.webp` })),
      ),
    );
  },
};

// ─────────────────────────── Cloudinary ───────────────────────────
let cloudinaryConfigured = false;
function ensureCloudinary() {
  if (!cloudinaryConfigured) {
    // CLOUDINARY_URL is read by the SDK from the environment; make sure it's set from config.
    process.env.CLOUDINARY_URL = config.CLOUDINARY_URL;
    cloudinary.config({ secure: true });
    cloudinaryConfigured = true;
  }
}

const cloudinaryStore: ImageStore = {
  upload(venueId, buffer) {
    ensureCloudinary();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(appError('UPSTREAM_ERROR')), UPLOAD_TIMEOUT_MS);
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: config.CLOUDINARY_FOLDER,
          public_id: venueId,
          overwrite: true,
          invalidate: true,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
        },
        (err, result) => {
          clearTimeout(timer);
          if (err || !result) return reject(err?.http_code === 400 ? appError('IMAGE_INVALID') : appError('UPSTREAM_ERROR'));
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  },
  async destroy(publicId) {
    ensureCloudinary();
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  },
};

// ─────────────────────────── selection + delivery URLs ───────────────────────────
const stores = { neon: neonStore, cloudinary: cloudinaryStore, fake: fakeStore } as const;

export const imageStore: ImageStore = stores[config.IMAGE_STORE];
export const fakeImagesDir = fakeDir;

/** Delivery URLs (§10.19) for whichever store wrote the row; rows may predate a store switch. */
export function imageUrls(secureUrl: string | null): { imageUrl: string | null; imageThumbUrl: string | null } {
  if (!secureUrl) return { imageUrl: null, imageThumbUrl: null };
  if (secureUrl.startsWith(FAKE_HOST)) {
    const [version, id] = secureUrl.slice(FAKE_HOST.length).split('/');
    const url = `${config.BETTER_AUTH_URL}/dev-images/${id}?${version}`;
    return { imageUrl: url, imageThumbUrl: url };
  }
  if (secureUrl.includes('/upload/') && new URL(secureUrl).hostname === 'res.cloudinary.com') {
    const insert = (t: string) => secureUrl.replace('/upload/', `/upload/${t}/`);
    return {
      imageUrl: insert('c_fill,g_auto,w_1200,h_675,f_auto,q_auto'),
      imageThumbUrl: insert('c_fill,g_auto,w_640,h_360,f_auto,q_auto'),
    };
  }
  // Neon: renditions were produced at upload time; the thumbnail sits next to the main object.
  if (secureUrl.endsWith('.webp')) return { imageUrl: secureUrl, imageThumbUrl: secureUrl.replace(/\.webp$/, '-thumb.webp') };
  return { imageUrl: secureUrl, imageThumbUrl: secureUrl };
}
