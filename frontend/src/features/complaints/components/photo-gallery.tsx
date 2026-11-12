// PhotoGallery + Lightbox (§16.3, [SRC] image viewer): 104 px thumbnails; full-screen-on-mobile viewer with
// previous/next, arrow keys, "2 of 3", Escape, focus trap (Radix Dialog) and native pinch-zoom.
// Signed URLs expire after 10 minutes: a failed image asks the page to refetch once, then shows a placeholder (CEC-22).
import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import type { ComplaintAttachment } from '@campushub/shared';
import { cn } from '@/lib/utils';

function SignedImg({ src, alt, className, onExpired }: { src: string; alt: string; className?: string; onExpired?: () => void }) {
  const [failed, setFailed] = React.useState(false);
  const retried = React.useRef(false);
  React.useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <span className={cn('grid place-items-center bg-surface-muted text-center text-[11px] text-muted', className)} role="img" aria-label="Couldn't load photo">
        <ImageOff className="size-5" aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (!retried.current && onExpired) {
          retried.current = true;
          onExpired();
        } else setFailed(true);
      }}
    />
  );
}

export function PhotoGallery({ photos, label, onExpired }: { photos: ComplaintAttachment[]; label: string; onExpired?: () => void }) {
  const [open, setOpen] = React.useState<number | null>(null);
  if (!photos.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2.5" aria-label={label}>
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
              className="press block size-[104px] overflow-hidden rounded-[10px] border border-border bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <SignedImg src={p.thumbUrl} alt="" className="size-full object-cover" onExpired={onExpired} />
            </button>
          </li>
        ))}
      </ul>
      <Lightbox photos={photos} index={open} onIndex={setOpen} onExpired={onExpired} />
    </>
  );
}

export function Lightbox({
  photos,
  index,
  onIndex,
  onExpired,
}: {
  photos: ComplaintAttachment[];
  index: number | null;
  onIndex: (i: number | null) => void;
  onExpired?: () => void;
}) {
  const n = photos.length;
  const go = (d: number) => index !== null && onIndex((index + d + n) % n);
  const photo = index !== null ? photos[index] : null;
  return (
    <D.Root open={index !== null} onOpenChange={(o) => !o && onIndex(null)}>
      <D.Portal>
        <D.Overlay className="overlay fixed inset-0 z-[80] bg-black/90" />
        <D.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(1);
            if (e.key === 'ArrowLeft') go(-1);
          }}
          className="fixed inset-0 z-[80] flex flex-col outline-none md:inset-6"
        >
          <D.Title className="sr-only">Photo viewer</D.Title>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="tabular text-sm font-semibold" aria-live="polite">
              {index !== null ? `${index + 1} of ${n}` : ''}
            </span>
            <D.Close className="press grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close photo viewer">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4" style={{ touchAction: 'pinch-zoom' }}>
            {photo && <SignedImg key={photo.id} src={photo.url} alt={`Photo ${index! + 1} of ${n}`} className="max-h-full max-w-full rounded-[6px] object-contain" onExpired={onExpired} />}
            {n > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="press absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="press absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
