import * as React from 'react';
import { Link } from 'react-router';
import { AirVent, ArrowRight, Check, DoorOpen, MapPin, Mic, Monitor, Presentation, Projector, Theater, Users, Wifi } from 'lucide-react';
import { VENUE_TYPE_LABELS, type VenueSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { venueGradient } from '@/lib/venue-palette';

/** Deterministic gradient banner with a decorative ring and door icon; uses the photo when one exists (§19.2). */
export function VenueBanner({
  venueId,
  imageUrl,
  alt,
  className,
  children,
  icon = true,
  rounded = true,
}: {
  venueId: string;
  imageUrl?: string | null;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
  icon?: boolean;
  rounded?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const showImage = imageUrl && !failed;
  return (
    <div className={cn('relative isolate overflow-hidden', rounded && 'rounded-[14px]', className)} style={{ background: venueGradient(venueId) }}>
      {showImage ? (
        <img
          src={imageUrl!}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          width={640}
          height={360}
          onError={() => setFailed(true)}
          className="absolute inset-0 -z-10 size-full object-cover"
        />
      ) : (
        <>
          <span aria-hidden className="absolute -right-10 -top-12 -z-10 size-40 rounded-full border-[18px] border-white/10" />
          <span aria-hidden className="absolute -bottom-16 left-1/3 -z-10 size-32 rounded-full bg-white/[0.04]" />
          {icon && <DoorOpen aria-hidden className="absolute bottom-3 right-3.5 -z-10 size-7 text-white/90" strokeWidth={1.75} />}
        </>
      )}
      {children}
    </div>
  );
}

export function amenityIcon(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toLowerCase();
  if (n.includes('projector')) return Projector;
  if (n.includes('board')) return Presentation;
  if (n === 'ac' || n.includes('air')) return AirVent;
  if (n.includes('wifi') || n.includes('wi-fi')) return Wifi;
  if (n.includes('mic') || n.includes('sound') || n.includes('speaker')) return Mic;
  if (n.includes('stage')) return Theater;
  if (n.includes('computer') || n.includes('pc')) return Monitor;
  return Check;
}

export function AmenityChip({ name, dense = false, onRemove }: { name: string; dense?: boolean; onRemove?: () => void }) {
  const Icon = amenityIcon(name);
  return (
    <span
      className={cn(
        'chip inline-flex max-w-full items-center gap-1 rounded-full bg-secondary-soft font-semibold text-secondary-text',
        dense ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-[12px]',
      )}
    >
      <Icon className={dense ? 'size-3' : 'size-3.5'} />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          // 24×24 target (WCAG 2.2 2.5.8) without growing the chip: negative margins absorb the extra size.
          className="-my-1 -mr-2 ml-0 grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-150 hover:bg-secondary/15"
          aria-label={`Remove ${name}`}
        >
          <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

export function VenueCard({
  venue,
  to,
  freeChip,
  action,
  headingLevel = 3,
}: {
  /** 2 when the grid sits directly under the page h1. */
  headingLevel?: 2 | 3;
  venue: VenueSummary;
  to: string;
  freeChip?: string | null;
  action?: React.ReactNode;
}) {
  const VenueHeading = headingLevel === 2 ? 'h2' : 'h3';
  const extra = venue.amenities.length - 3;
  return (
    <article className="card lift group relative flex flex-col overflow-hidden">
      <VenueBanner venueId={venue.id} imageUrl={venue.imageThumbUrl} rounded={false} className="h-24">
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <span className="chip tabular inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[12px] font-semibold text-white backdrop-blur-[2px]">
            <Users className="size-3.5" aria-hidden />
            <span className="sr-only">Capacity </span>
            {formatNumber(venue.capacity)}
          </span>
          <span className="chip rounded-full bg-white/90 px-2 py-0.5 text-[11.5px] font-semibold text-ink">{VENUE_TYPE_LABELS[venue.venueType]}</span>
        </div>
      </VenueBanner>
      <div className="flex flex-1 flex-col p-4">
        <VenueHeading className="truncate text-[15px] font-semibold leading-[21px] text-ink" title={venue.name}>
          <Link to={to} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[14px] focus-visible:after:outline-2 focus-visible:after:outline-ring">
            {venue.name}
          </Link>
        </VenueHeading>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[13px] text-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {venue.building}
            {venue.locationDetails ? ` · ${venue.locationDetails}` : ''}
          </span>
        </p>
        {venue.amenities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {venue.amenities.slice(0, 3).map((a) => (
              <AmenityChip key={a} name={a} dense />
            ))}
            {extra > 0 && <span className="chip rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted">+{extra}</span>}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          {freeChip ? (
            <span className="chip tabular rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success-text">{freeChip}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
              View details <ArrowRight className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
            </span>
          )}
          {action && <div className="relative z-10">{action}</div>}
        </div>
      </div>
    </article>
  );
}
