// Dev-only break-ui harness (/dev/break-ui). Never shipped: the route is registered only when import.meta.env.DEV.
import { useSearchParams } from 'react-router';
import { ROLES } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { BookingCard } from '@/components/common/booking-visuals';
import { VenueCard } from '@/components/common/venue-visuals';
import { NotificationItem } from '@/components/common/notification-bell';
import { RoleBadge, StatusBadge } from '@/components/common/badges';
import { UserAvatar } from '@/components/common/small';
import { EmptyState } from '@/components/common/states';
import { PendingRequestCard } from '@/features/admin/approvals/approvals-page';
import { BookingsTable } from '@/features/admin/bookings/bookings-page';
import { fixtures, worstNames, type Dataset } from './break-ui-fixtures';

const STATES: { value: Dataset; label: string }[] = [
  { value: 'demo', label: 'Demo data' },
  { value: 'worst', label: 'Worst case' },
  { value: 'one', label: 'One' },
  { value: 'empty', label: 'Empty' },
];

export default function BreakUiPage() {
  const [params, setParams] = useSearchParams();
  const data = (params.get('data') as Dataset) || 'demo';
  const f = fixtures(data);
  return (
    <div className="min-h-dvh bg-background px-4 pb-28 pt-6 md:px-8">
      <div className="mx-auto grid max-w-[1200px] gap-8">
        <section>
          <h2 className="eyebrow mb-3">VenueCard (grid)</h2>
          {f.venues.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {f.venues.map((v) => (
                <VenueCard key={v.id} venue={v} to="#" />
              ))}
            </div>
          ) : (
            <div className="card"><EmptyState compact title="No venues yet" /></div>
          )}
        </section>
        <section>
          <h2 className="eyebrow mb-3">BookingCard (2-col)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {f.bookings.map((b) => (
              <BookingCard key={b.id} booking={b} to="#" today="2026-11-09" />
            ))}
          </div>
        </section>
        <section>
          <h2 className="eyebrow mb-3">PendingRequestCard</h2>
          {f.admin.map((b) => (
            <PendingRequestCard key={b.id} b={b} today="2026-11-09" leaving={false} onDecide={() => {}} />
          ))}
        </section>
        <section>
          <h2 className="eyebrow mb-3">BookingsTable</h2>
          {f.admin.length ? <BookingsTable rows={f.admin} sort="createdAt:desc" onSort={() => {}} onDecide={() => {}} /> : null}
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="eyebrow mb-3">NotificationItem (popover width)</h2>
            <div className="card w-full max-w-[380px] p-2">
              {f.notes.map((n) => (
                <NotificationItem key={n.id} n={n} onOpen={() => {}} />
              ))}
            </div>
          </div>
          <div>
            <h2 className="eyebrow mb-3">UserAvatar initials + badges</h2>
            <div className="card grid gap-2 p-4">
              {(data === 'worst' ? worstNames : ['Priya Sharma', 'Daniel Okafor']).map((n, i) => (
                <div key={n} className="flex flex-wrap items-center gap-3">
                  <UserAvatar name={n} role={ROLES[i % 3]!} size={32} />
                  <span className="min-w-0 truncate text-sm">{n}</span>
                  <RoleBadge role={ROLES[i % 3]!} />
                  <StatusBadge status={(['pending', 'approved', 'rejected', 'cancelled', 'expired'] as const)[i % 5]!} size="sm" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-full bg-[#E5E7EB] p-1 font-[system-ui] text-[12px] shadow">
        {STATES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setParams({ data: s.value }, { replace: true })}
            className={cn('rounded-full px-3 py-1.5', data === s.value ? 'bg-white font-semibold text-black shadow-sm' : 'text-[#4B5563]')}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
