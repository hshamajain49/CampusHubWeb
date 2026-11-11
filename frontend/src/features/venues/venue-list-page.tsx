import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Building2, CalendarDays, Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { VENUE_TYPES, VENUE_TYPE_LABELS, addDays, timeToMinutes } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { useDebouncedValue, useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox, Skeleton } from '@/components/ui/controls';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { VenueCard } from '@/components/common/venue-visuals';
import { Pagination } from '@/components/common/small';
import { DatePicker, TimeSelect } from '@/components/common/pickers';
import { useVenues } from './api';
import { patchParams } from '@/lib/search-params';

const SORTS = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'capacity:asc', label: 'Capacity (low–high)' },
  { value: 'capacity:desc', label: 'Capacity (high–low)' },
];

function AmenitiesSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-left text-sm shadow-[0_1px_1px_rgba(20,27,45,0.03)] md:h-10"
        >
          <span className={cn('flex-1 truncate', !value.length && 'text-subtle')}>{value.length ? value.join(', ') : 'Any amenities'}</span>
          {value.length > 0 && <span className="tabular rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary">{value.length}</span>}
          <ChevronDown className="size-4 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        {options.length === 0 ? (
          <p className="p-3 text-[13px] text-muted">No amenities listed yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto">
            {options.map((a) => {
              const checked = value.some((v) => v.toLowerCase() === a.toLowerCase());
              return (
                <li key={a}>
                  <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-sm hover:bg-surface-muted">
                    <Checkbox checked={checked} onCheckedChange={(c) => onChange(c ? [...value, a] : value.filter((v) => v.toLowerCase() !== a.toLowerCase()))} />
                    {a}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function VenueListPage() {
  useDocumentTitle('Book a venue');
  const [params, setParams] = useSearchParams();
  const mdUp = useIsMdUp();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const rules = settings?.bookingRules;
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  const get = (k: string) => params.get(k) ?? '';
  const set = (patch: Record<string, string | null>, resetPage = true) => {
    setParams(patchParams(params, patch, resetPage), { replace: true });
  };

  const [q, setQ] = React.useState(get('q'));
  const dq = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => {
    if (dq !== get('q')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const amenities = get('amenities') ? get('amenities').split(',') : [];
  const freeDate = get('date');
  const freeStart = get('start');
  const freeEnd = get('end');
  const freeComplete = !!(freeDate && freeStart && freeEnd && timeToMinutes(freeEnd) > timeToMinutes(freeStart));
  const freePartial = !freeComplete && !!(freeDate || freeStart || freeEnd);
  const page = Number(get('page') || 1);

  const list = useVenues({
    q: get('q') || undefined,
    type: get('type') || undefined,
    minCapacity: get('minCapacity') ? Number(get('minCapacity')) : undefined,
    amenities: amenities.length ? amenities : undefined,
    availableDate: freeComplete ? freeDate : undefined,
    availableStart: freeComplete ? freeStart : undefined,
    availableEnd: freeComplete ? freeEnd : undefined,
    sort: get('sort') || 'name:asc',
    page,
    pageSize: 12,
  });

  const active = !!(get('q') || get('type') || get('minCapacity') || amenities.length || freeDate || freeStart || freeEnd);
  const activeCount = [get('q'), get('type'), get('minCapacity'), amenities.length ? 'a' : '', freeComplete ? 'f' : ''].filter(Boolean).length;
  const clear = () => {
    setQ('');
    setParams(new URLSearchParams(get('sort') ? { sort: get('sort') } : {}), { replace: true });
  };

  const filters = (
    <div className="grid gap-3 md:grid-cols-12 md:items-end">
      <div className="relative md:col-span-4 lg:col-span-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
        <Input
          aria-label="Search by name or building"
          placeholder="Search by name or building"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-10"
          type="search"
          enterKeyHint="search"
        />
      </div>
      <div className="md:col-span-3 lg:col-span-2">
        <Select
          aria-label="Venue type"
          value={get('type') || 'all'}
          onValueChange={(v) => set({ type: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All types' }, ...VENUE_TYPES.map((t) => ({ value: t, label: VENUE_TYPE_LABELS[t] }))]}
        />
      </div>
      <div className="md:col-span-2 lg:col-span-2">
        <Input
          aria-label="Minimum capacity"
          placeholder="Min. capacity"
          inputMode="numeric"
          value={get('minCapacity')}
          onChange={(e) => set({ minCapacity: e.target.value.replace(/\D/g, '').slice(0, 6) || null })}
        />
      </div>
      <div className="md:col-span-3 lg:col-span-2">
        <AmenitiesSelect options={list.data?.meta.amenityOptions ?? []} value={amenities} onChange={(v) => set({ amenities: v.length ? v.join(',') : null })} />
      </div>
      <div className="md:col-span-12 lg:col-span-3">
        <Select aria-label="Sort" value={get('sort') || 'name:asc'} onValueChange={(v) => set({ sort: v === 'name:asc' ? null : v })} options={SORTS} />
      </div>
      {rules && now && (
        <fieldset className="md:col-span-12">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink">Free at</legend>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <DatePicker value={freeDate || null} onChange={(v) => set({ date: v })} min={now.date} max={addDays(now.date, rules.maxAdvanceDays)} placeholder="Any date" />
            <TimeSelect aria-label="From" placeholder="From" value={freeStart} onChange={(v) => set({ start: v })} open={rules.operatingHoursStart} close={rules.operatingHoursEnd} step={rules.timeStepMinutes} />
            <TimeSelect
              aria-label="Until"
              placeholder="Until"
              value={freeEnd}
              onChange={(v) => set({ end: v })}
              open={rules.operatingHoursStart}
              close={rules.operatingHoursEnd}
              step={rules.timeStepMinutes}
              isDisabled={(t) => (freeStart && timeToMinutes(t) <= timeToMinutes(freeStart) ? 'before start' : false)}
            />
            {(freeDate || freeStart || freeEnd) && (
              <Button variant="ghost" onClick={() => set({ date: null, start: null, end: null })} aria-label="Clear availability filter">
                <X /> Clear time
              </Button>
            )}
          </div>
          {freePartial && <p className="mt-1.5 text-[12.5px] text-muted">Pick a date, start and end to filter by availability</p>}
        </fieldset>
      )}
    </div>
  );

  const total = list.data?.meta.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Book a venue"
        description={list.data ? `${total} ${total === 1 ? 'space' : 'spaces'} ${freeComplete ? 'free at that time' : 'available'}` : 'Finding spaces…'}
        actions={
          <Button variant="outline" asChild>
            <Link to="/bookings">
              <CalendarDays /> My bookings
            </Link>
          </Button>
        }
      />

      {mdUp ? (
        <div className="card sticky top-[72px] z-30 mb-6 p-4">
          {filters}
          {active && (
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={clear} className="text-[13px] font-semibold text-primary hover:underline">
                Clear filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-5 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search by name or building" placeholder="Search venues" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" type="search" />
          </div>
          <Button variant="outline" size="lg" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal /> Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="bottom" title="Filters">
              <div className="grid gap-4 px-5 pb-4">
                {filters}
                <div className="flex gap-2">
                  {active && (
                    <Button variant="outline" className="flex-1" onClick={clear}>
                      Clear filters
                    </Button>
                  )}
                  <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
                    <Check /> Show {total} {total === 1 ? 'venue' : 'venues'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[238px] rounded-[14px]" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : total === 0 ? (
        <div className="card">
          {active ? (
            <EmptyState
              icon={Search}
              title="No venues match your filters."
              message="Try removing a filter or choosing another time."
              action={<Button variant="outline" onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <EmptyState icon={Building2} title="No venues yet" message="No venues are available for booking right now." />
          )}
        </div>
      ) : (
        <>
          <div key={`${page}-${list.dataUpdatedAt > 0 ? 'r' : 'l'}`} className={cn('stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3', list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
            {list.data!.data.map((v) => (
              <VenueCard
                key={v.id}
                venue={v}
                to={`/venues/${v.id}`}
                freeChip={freeComplete ? `Available ${freeStart}–${freeEnd}` : null}
                action={
                  freeComplete ? (
                    <Button size="sm" asChild>
                      <Link to={`/bookings/new?venueId=${v.id}&date=${freeDate}&start=${freeStart}&end=${freeEnd}`}>Book this time</Link>
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={12}
            total={total}
            onPage={(p) => {
              set({ page: p > 1 ? String(p) : null }, false);
              window.scrollTo({ top: 0 });
            }}
          />
        </>
      )}
    </div>
  );
}
