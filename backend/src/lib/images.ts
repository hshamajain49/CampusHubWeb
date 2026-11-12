// Complaint photo processing (COMPLAINT_REGISTRATION_SPEC.md §12.2 step 4). The type is decided by decoding the bytes,
// never by the file name or Content-Type. Re-encoding to WebP drops EXIF/GPS and any embedded payloads.
import sharp from 'sharp';
import { appError } from '../errors/app-error.js';

const FORMATS = new Set(['jpeg', 'png', 'webp']);
/** Rejects decompression bombs before decoding pixels (12 000 × 12 000). */
const MAX_INPUT_PIXELS = 12_000 * 12_000;

export interface ProcessedImage {
  full: { body: Buffer; width: number; height: number; size: number };
  thumb: { body: Buffer; width: number; height: number; size: number };
}

/** File signature: JPEG FF D8 FF, PNG 89 'PNG', WebP 'RIFF'….'WEBP'. Anything else is an unsupported type (415). */
export function sniffImageType(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function processPhoto(buffer: Buffer, fileName = 'photo'): Promise<ProcessedImage> {
  const sniffed = sniffImageType(buffer);
  if (!sniffed) throw appError('UNSUPPORTED_FILE_TYPE', undefined, { file: fileName });
  let format: string | undefined;
  try {
    format = (await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw appError('IMAGE_UNREADABLE', undefined, { file: fileName }); // right signature, unreadable header
  }
  if (!format || !FORMATS.has(format)) throw appError('UNSUPPORTED_FILE_TYPE', undefined, { file: fileName });

  try {
    const base = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    const [full, thumb] = await Promise.all([
      base().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true }),
      base().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer({ resolveWithObject: true }),
    ]);
    return {
      full: { body: full.data, width: full.info.width, height: full.info.height, size: full.info.size },
      thumb: { body: thumb.data, width: thumb.info.width, height: thumb.info.height, size: thumb.info.size },
    };
  } catch {
    // Corrupt data, or more pixels than the limit.
    throw appError('IMAGE_UNREADABLE', undefined, { file: fileName });
  }
}
