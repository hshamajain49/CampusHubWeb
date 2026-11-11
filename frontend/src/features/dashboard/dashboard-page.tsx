import { Link } from 'react-router';
import { ArrowRight, CalendarCheck, CalendarDays, CalendarPlus, Clock, DoorOpen, History, Hourglass, MapPin } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { firstName } from '@/lib/utils';
import { formatDate, formatLongDate, formatTimeRange, greetingFor } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { RoleBadge, StatusBadge } from '@/components/common/badges';
import { SectionCard, StatCard, ViewAllLink } from '@/components/common/layout-bits';
import { EmptyState, SectionError } from '@/components/common/states';
import { VenueBanner } from '@/components/common/venue-visuals';
import { TimingChip } from '@/components/common/booking-visuals';
import { DayAvailabilityBar } from '@/components/common/day-availability-bar';
import { useMemberDashboard } from '@/features/bookings/api';

const QUICK = [
  { to: '/venues', icon: CalendarPlus, title: 'Book a venue', text: 'Find and reserve a space', tone: 'bg-primary-soft text-primary' },
  { to: '/bookings', icon: CalendarDays, title: 'My bookings', text: 'Track your requests', tone: 'bg-secondary-soft text-secondary-text' },
  { to: '/bookings/history', icon: History, title: 'Booking history', text: 'Past and closed bookings', tone: 'bg-surface-muted text-muted' },
];

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const me = useMe();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const dash = useMemberDashboard();
  const d = dash.data;
  const next = d?.nextBooking;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[20px] font-semibold leading-7 text-ink sm:text-2xl sm:leading-8">
          {now ? greetingFor(now.minutesOfDay) : 'Hello'}, {firstName(me.fullName)}
        </h1>
        <RoleBadge role={me.role} />
      </div>

      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 md:gap-4">
        {dash.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[138px] rounded-[14px]" />)
        ) : dash.isError ? (
          <div className="sm:col-span-2 md:col-span-3">
            <SectionError onRetry={() => dash.refetch()} />
          </div>
        ) : (
          <>
            <StatCard icon={Hourglass} tone="pending" label="Pending requests" value={d!.counts.pending} to="/bookings?status=pending" />
            <StatCard icon={CalendarCheck} tone="approved" label="Upcoming bookings" value={d!.counts.upcomingApproved} to="/bookings?status=approved" />
            <div className="sm:col-span-2 md:col-span-1">
              <StatCard icon={History} tone="neutral" label="Past & closed" value={d!.counts.history} to="/bookings/history" />
            </div>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-labelledby="next-heading">
          <h2 id="next-heading" className="eyebrow mb-2.5">
            Next booking
          </h2>
          {dash.isLoading ? (
            <Skeleton className="h-[236px] rounded-[14px]" />
          ) : next ? (
            <Link to={`/bookings/${next.id}`} className="card lift press group block overflow-hidden">
              <VenueBanner venueId={next.venue.id} rounded={false} className="h-[72px]">
                <div className="absolute inset-x-4 bottom-3 flex items-end justify-between">
                  <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[12px] font-semibold text-ink">{next.reference}</span>
                </div>
              </VenueBanner>
              <div className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-display text-[18px] font-semibold leading-6 text-ink">{next.venue.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
                      <MapPin className="size-3.5" /> {next.venue.building}
                    </p>
                  </div>
                  <StatusBadge status={next.status} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
                  <span className="tabular inline-flex items-center gap-1.5 font-semibold">
                    <CalendarDays className="size-4 text-muted" /> {formatLongDate(next.date)}
                  </span>
                  <span className="tabular inline-flex items-center gap-1.5 font-semibold">
                    <Clock className="size-4 text-muted" /> {formatTimeRange(next.startTime, next.endTime)}
                  </span>
                  <TimingChip booking={next} today={now?.date} />
                </div>
                {settings && (
                  <DayAvailabilityBar
                    className="mt-4"
                    date={next.date}
                    open={settings.bookingRules.operatingHoursStart}
                    close={settings.bookingRules.operatingHoursEnd}
                    intervals={[]}
                    selection={{ start: next.startTime, end: next.endTime }}
                  />
                )}
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
                  View details <ArrowRight className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ) : (
            <div className="card">
              <EmptyState
                compact
                icon={DoorOpen}
                title="No upcoming bookings."
                message="When you reserve a space, its date and time will show up here."
                action={
                  <Button asChild>
                    <Link to="/venues">
                      <CalendarPlus /> Book a venue
                    </Link>
                  </Button>
                }
              />
            </div>
          )}
        </section>

        <section className="lg:col-span-5" aria-labelledby="quick-heading">
          <h2 id="quick-heading" className="eyebrow mb-2.5">
            Quick actions
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {QUICK.map((q) => (
              <Link key={q.to} to={q.to} className="card lift press group flex items-center gap-3.5 p-4">
                <span className={`grid size-11 shrink-0 place-items-center rounded-[12px] ${q.tone}`}>
                  <q.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{q.title}</span>
                  <span className="block text-[13px] text-muted">{q.text}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-subtle transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <SectionCard title="Recent requests" action={<ViewAllLink to="/bookings" />} bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
        {dash.isLoading ? (
          <div className="grid gap-2 p-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : dash.isError ? (
          <div className="p-2">
            <SectionError onRetry={() => dash.refetch()} />
          </div>
        ) : d!.recentBookings.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">Reserve a venue and it will show up here.</p>
        ) : (
          <ul className="stagger grid">
            {d!.recentBookings.map((b) => (
              <li key={b.id}>
                <Link to={`/bookings/${b.id}`} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-100 hover:bg-surface-muted">
                  <VenueBanner venueId={b.venue.id} className="size-10 shrink-0 rounded-[10px]" icon={false}>
                    <DoorOpen className="absolute inset-0 m-auto size-[18px] text-white" />
                  </VenueBanner>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{b.venue.name}</span>
                    <span className="tabular block truncate text-[12.5px] text-muted">
                      {formatDate(b.date)} · {b.purpose}
                    </span>
                  </span>
                  <StatusBadge status={b.status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
