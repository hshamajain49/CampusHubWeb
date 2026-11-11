import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Building2, CalendarPlus, LayoutGrid, MapPin, Shapes, Users } from 'lucide-react';
import { VENUE_TYPE_LABELS, addDays, localDateTimeToMinutes, toLocalDateTime, type AvailabilityInterval, type PublicSettings, type Venue } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatShortDay, formatNumber } from '@/lib/format';
import { isApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Breadcrumb, SectionCard } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { AmenityChip, VenueBanner } from '@/components/common/venue-visuals';
import { DayAvailabilityBar } from '@/components/common/day-availability-bar';
import { useAvailability, useVenue } from './api';

const VenueAvailabilityTab = React.lazy(() => import('./venue-availability-tab'));

function dayStatus(date: string, intervals: AvailabilityInterval[], open: string, close: string): 'free' | 'partly' | 'full' {
  const s = localDateTimeToMinutes(toLocalDateTime(date, open));
  const e = localDateTimeToMinutes(toLocalDateTime(date, close));
  let busy = 0;
  const segs = intervals
    .map((i) => [Math.max(localDateTimeToMinutes(i.start), s), Math.min(localDateTimeToMinutes(i.end), e)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let cursor = s;
  for (const [a, b] of segs) {
    if (b <= cursor) continue;
    busy += b - Math.max(a, cursor);
    cursor = Math.max(cursor, b);
  }
  if (busy === 0) return 'free';
  return busy >= e - s ? 'full' : 'partly';
}

function NextSevenDays({ venueId, settings, onPick }: { venueId: string; settings: PublicSettings; onPick: (date: string) => void }) {
  const now = useCampusNow();
  const from = now?.date;
  const to = from ? addDays(from, 6) : undefined;
  const avail = useAvailability(venueId, from, to);
  const { operatingHoursStart: open, operatingHoursEnd: close } = settings.bookingRules;
  if (!from) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const LABEL = { free: 'Fully free', partly: 'Partly booked', full: 'Unavailable' } as const;
  return (
    <SectionCard title="Next 7 days">
      {avail.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="grid gap-1">
          {days.map((d) => {
            const list = (avail.data?.intervals ?? []).filter((i) => i.start.slice(0, 10) <= d && i.end.slice(0, 10) >= d);
            const st = dayStatus(d, list, open, close);
            return (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  className="group grid w-full grid-cols-[88px_minmax(0,1fr)_96px] items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors duration-100 hover:bg-surface-muted"
                >
                  <span className="tabular text-[13px] font-semibold text-ink">{d === from ? 'Today' : formatShortDay(d)}</span>
                  <DayAvailabilityBar date={d} open={open} close={close} intervals={list} compact showTicks={false} />
                  <span className={cn('text-right text-[12px] font-semibold', st === 'free' ? 'text-success-text' : st === 'partly' ? 'text-warning-text' : 'text-muted')}>
                    {LABEL[st]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function Facts({ venue }: { venue: Venue }) {
  const facts = [
    { icon: Building2, label: 'Building', value: venue.building },
    { icon: MapPin, label: 'Location', value: venue.locationDetails ?? '—' },
    { icon: Users, label: 'Capacity', value: `${formatNumber(venue.capacity)} people` },
    { icon: Shapes, label: 'Type', value: VENUE_TYPE_LABELS[venue.venueType] },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="card p-4">
          <f.icon className="size-[18px] text-secondary" aria-hidden />
          <p className="mt-2.5 text-[12px] font-medium text-muted">{f.label}</p>
          <p className="tabular mt-0.5 break-words text-sm font-semibold text-ink">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

export function VenueDetailPage() {
  const { venueId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'availability' ? 'availability' : 'overview';
  const { data: settings } = usePublicSettings();
  const venue = useVenue(venueId);
  useDocumentTitle(venue.data?.name ?? 'Venue');

  if (venue.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-40 rounded-[14px] md:h-[220px]" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-[14px]" />
      </div>
    );
  }
  if (venue.isError) {
    if (isApiError(venue.error) && venue.error.status === 404) {
      return (
        <div className="card">
          <EmptyState
            title="Venue not available"
            message="This venue doesn't exist or isn't accepting bookings."
            action={
              <Button asChild>
                <Link to="/venues">Browse venues</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return <ErrorState onRetry={() => venue.refetch()} />;
  }
  const v = venue.data!;
  const bookHref = `/bookings/new?venueId=${v.id}`;
  const setTab = (t: string, date?: string) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    if (date) next.set('date', date);
    else if (t === 'overview') next.delete('date');
    setParams(next, { replace: true });
  };

  return (
    <div className="pb-20 lg:pb-0">
      <VenueBanner venueId={v.id} imageUrl={v.imageUrl} alt={v.name} className="h-40 md:h-[220px]">
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(0,0,0,0.5))]" />
        <div className="absolute inset-x-5 bottom-4 md:inset-x-7 md:bottom-6">
          <span className="chip rounded-full bg-white/90 px-2.5 py-0.5 text-[12px] font-semibold text-ink">{VENUE_TYPE_LABELS[v.venueType]}</span>
          <h1 className="mt-2 font-display text-[24px] font-semibold leading-8 text-white md:text-[28px] md:leading-9">{v.name}</h1>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-white/85">
            <MapPin className="size-3.5" /> {v.building}
          </p>
        </div>
      </VenueBanner>

      <Breadcrumb className="mt-4" items={[{ label: 'Venues', to: '/venues' }, { label: v.name }]} />

      <div className="mt-4 grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <Tabs value={tab} onValueChange={(t) => setTab(t)}>
            <TabsList>
              <TabsTrigger value="overview">
                <LayoutGrid className="size-4" /> Overview
              </TabsTrigger>
              <TabsTrigger value="availability">
                <CalendarPlus className="size-4" /> Availability
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-5 grid gap-5 outline-none">
              <Facts venue={v} />
              <SectionCard title="About this space">
                <p className="whitespace-pre-line text-sm leading-6 text-ink">{v.description}</p>
                {v.amenities.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {v.amenities.map((a) => (
                      <AmenityChip key={a} name={a} />
                    ))}
                  </div>
                )}
              </SectionCard>
              {settings && <NextSevenDays venueId={v.id} settings={settings} onPick={(d) => setTab('availability', d)} />}
            </TabsContent>
            <TabsContent value="availability" className="mt-5 outline-none">
              {settings && (
                <React.Suspense fallback={<Skeleton className="h-[540px] rounded-[14px]" />}>
                  <VenueAvailabilityTab venueId={v.id} settings={settings} initialDate={params.get('date') ?? undefined} />
                </React.Suspense>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <aside className="hidden lg:col-span-4 lg:block">
          <div className="card sticky top-[88px] p-5">
            <p className="eyebrow">Book this venue</p>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Capacity</dt>
                <dd className="tabular font-semibold text-ink">{formatNumber(v.capacity)} people</dd>
              </div>
              {settings && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Bookable</dt>
                  <dd className="tabular font-semibold text-ink">
                    {settings.bookingRules.operatingHoursStart}–{settings.bookingRules.operatingHoursEnd}
                  </dd>
                </div>
              )}
            </dl>
            <Button asChild size="lg" className="mt-5 w-full">
              <Link to={bookHref}>
                <CalendarPlus /> Book this venue
              </Link>
            </Button>
            <p className="mt-3 text-center text-[12.5px] text-muted">Requests are reviewed by the administrator.</p>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-[6px] safe-bottom lg:hidden">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{v.name}</p>
            <p className="tabular text-[12px] text-muted">
              Up to {formatNumber(v.capacity)} people{settings ? ` · ${settings.bookingRules.operatingHoursStart}–${settings.bookingRules.operatingHoursEnd}` : ''}
            </p>
          </div>
          <Button asChild size="lg">
            <Link to={bookHref}>Book this venue</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

