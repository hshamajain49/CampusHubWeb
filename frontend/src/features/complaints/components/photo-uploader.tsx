// PhotoUploader (§16.3, §12.2 step 1): drop zone + "Add photos", up to 3 images, compressed in the browser to ≤ 2048 px
// (quality 0.8) before upload; 88 px thumbnails with remove buttons and a per-tile spinner/error.
import * as React from 'react';
import imageCompression from 'browser-image-compression';
import { ImagePlus, TriangleAlert, X } from 'lucide-react';
import { COMPLAINT_PHOTO_RULES } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

const MAX_BYTES = COMPLAINT_PHOTO_RULES.maxPhotoMb * 1024 * 1024;
const ACCEPT = COMPLAINT_PHOTO_RULES.acceptedTypes.join(',');

interface Item {
  id: string;
  name: string;
  preview: string | null;
  file: File | null;
  status: 'compressing' | 'ready' | 'error';
  error?: string;
}

/** Compression is swappable for tests (jsdom has no canvas). */
export const compressPhoto = (file: File): Promise<File> =>
  imageCompression(file, { maxWidthOrHeight: 2048, initialQuality: 0.8, maxSizeMB: COMPLAINT_PHOTO_RULES.maxPhotoMb, useWebWorker: true }).then(
    (blob) => new File([blob], file.name, { type: blob.type || file.type }),
  );

export function PhotoUploader({
  max = COMPLAINT_PHOTO_RULES.maxPhotos,
  onChange,
  disabled,
  error,
  label = 'Add photos',
  compress = compressPhoto,
}: {
  max?: number;
  /** Ready files, and whether any are still compressing. */
  onChange: (files: File[], busy: boolean) => void;
  disabled?: boolean;
  error?: string;
  label?: string;
  compress?: (f: File) => Promise<File>;
}) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  React.useEffect(() => {
    onChange(
      items.filter((i) => i.status === 'ready').map((i) => i.file!),
      items.some((i) => i.status === 'compressing'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  // Revoke every preview URL on unmount.
  React.useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const add = (list: FileList | File[]) => {
    const room = max - itemsRef.current.length;
    const incoming = Array.from(list).slice(0, Math.max(0, room));
    for (const file of incoming) {
      const id = crypto.randomUUID();
      if (!(COMPLAINT_PHOTO_RULES.acceptedTypes as readonly string[]).includes(file.type)) {
        setItems((s) => [...s, { id, name: file.name, preview: null, file: null, status: 'error', error: 'Only JPEG, PNG and WebP photos are supported.' }]);
        continue;
      }
      const preview = URL.createObjectURL(file);
      setItems((s) => [...s, { id, name: file.name, preview, file: null, status: 'compressing' }]);
      compress(file)
        .then((out) => {
          const tooBig = out.size > MAX_BYTES;
          setItems((s) =>
            s.map((i) =>
              i.id === id ? (tooBig ? { ...i, status: 'error', error: 'This photo is too large even after compression.' } : { ...i, file: out, status: 'ready' }) : i,
            ),
          );
        })
        .catch(() => setItems((s) => s.map((i) => (i.id === id ? { ...i, status: 'error', error: "This photo couldn't be read." } : i))));
    }
  };

  const remove = (id: string) => {
    setItems((s) => {
      const gone = s.find((i) => i.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return s.filter((i) => i.id !== id);
    });
    requestAnimationFrame(() => input.current?.focus());
  };

  const full = items.length >= max;
  const firstError = items.find((i) => i.status === 'error')?.error;
  return (
    <div className="grid gap-2">
      <div
        onDragOver={(e) => {
          if (disabled || full) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && !full) add(e.dataTransfer.files);
        }}
        className={cn('flex flex-wrap gap-2.5 rounded-[12px] transition-colors duration-150', dragging && 'bg-primary-soft/60')}
      >
        {items.map((it, i) => (
          <div key={it.id} className="relative size-[88px] shrink-0">
            <div
              className={cn(
                'size-full overflow-hidden rounded-[10px] border bg-surface-muted',
                it.status === 'error' ? 'border-destructive/60' : 'border-border',
              )}
            >
              {it.preview ? (
                <img src={it.preview} alt={`Photo ${i + 1}: ${it.name}`} className={cn('size-full object-cover', it.status !== 'ready' && 'opacity-60')} />
              ) : (
                <span className="grid size-full place-items-center p-2 text-center text-[11px] text-destructive-text">
                  <TriangleAlert className="size-5" aria-hidden />
                </span>
              )}
              {it.status === 'compressing' && (
                <span className="absolute inset-0 grid place-items-center">
                  <Spinner className="size-5 text-primary" />
                  <span className="sr-only">Preparing photo {i + 1}</span>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(it.id)}
              disabled={disabled}
              aria-label={`Remove photo ${i + 1}`}
              className="press absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-white shadow-[0_1px_3px_rgba(20,27,45,0.3)] disabled:opacity-50"
            >
              <X className="size-3.5" strokeWidth={3} />
            </button>
          </div>
        ))}
        {!full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={disabled}
            className="press grid size-[88px] shrink-0 place-items-center rounded-[10px] border-2 border-dashed border-[#C5CDDB] text-muted transition-colors duration-150 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <span className="grid justify-items-center gap-1 text-[12px] font-semibold">
              <ImagePlus className="size-5" aria-hidden />
              {items.length ? 'Add' : label}
            </span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <p className="tabular text-[12px] text-muted" aria-live="polite">
        {items.length}/{max} · JPEG, PNG or WebP. Drag photos here or tap {items.length ? 'Add' : label}.
      </p>
      {(error || firstError) && (
        <p role="alert" className="text-[12.5px] font-medium text-destructive-text">
          {firstError ?? error}
        </p>
      )}
    </div>
  );
}
