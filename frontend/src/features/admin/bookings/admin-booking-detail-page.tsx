import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Ban, Building2, CalendarDays, Clock, Download, IdCard, ListOrdered, NotebookPen, UsersRound } from 'lucide-react';
import { ROLE_LABELS, STATUS_LABELS, type Booking } from '@campushub/shared';
import { isApiError } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';

import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { InfoRow, PageHeader, SectionCard } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill, RoleBadge, StatusBadge } from '@/components/common/badges';
import { Timeline } from '@/components/common/timeline';
import { UserAvatar } from '@/components/common/small';
import { VenueBanner } from '@/components/common/venue-visuals';
import { StatusCallout } from '@/features/bookings/booking-detail-page';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useAdminBooking } from '../api';
import { CancelBookingDialog, StartsInChip } from './cancel-booking-dialog';
import { formatBookingLongDates, formatDuration, formatNumber, formatTimeRange, formatTimestamp } from '@/lib/format';

export default function AdminBookingDetailPage() {
  const { bookingId } = useParams();
  const me = useMe();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const q = useAdminBooking(bookingId);
  const [cancelling, setCancelling] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  useDocumentTitle(q.data ? `Booking ${q.data.reference}` : 'Booking');
  useAdminBreadcrumb(q.data ? [{ label: 'All bookings', to: '/admin/bookings' }, { label: q.data.reference }] : null);

  if (q.isLoading) return <Skeleton className="h-[600px] rounded-[14px]" />;
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <div className="card">
        <EmptyState title="Booking not found" message="It may have been removed." action={<Button asChild><Link to="/admin/bookings">All bookings</Link></Button>} />
      </div>
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }
  const b = q.data!;
  const tz = settings?.campusTimezone ?? 'UTC';
  const p = b.permissions;
  // The member-facing callout expects the member DTO shape; the fields it reads are shared.
  const asBooking = { ...b, cancelledBy: b.cancelledBy } as unknown as Booking;

  const panel = (
    <div className="grid gap-2">
      {b.status === 'queued' && (
        <p className="flex gap-2 rounded-[10px] bg-[#FDF4DC] px-3.5 py-3 text-[13px] text-[#7A5A00]">
          <ListOrdered className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            #{b.queuePosition ?? '?'} in the queue. It's confirmed automatically if the time frees up; nothing to approve.
          </span>
        </p>
      )}
      {p.canDownloadConfirmation && (
        <>
          <Button
            size="lg"
            loading={downloading}
            onClick={async () => {
              setDownloading(true);
              await downloadFile(`/admin/bookings/${b.id}/confirmation.pdf`, `booking-confirmation-${b.reference}.pdf`).catch(() => undefined);
              setDownloading(false);
            }}
          >
            <Download /> Download confirmation
          </Button>
        </>
      )}
      {p.canCancel && (
        <Button size="lg" variant="destructive-outline" onClick={() => setCancelling(true)}>
          <Ban /> {b.status === 'queued' ? 'Cancel request' : 'Cancel booking'}
        </Button>
      )}
      {(b.status === 'completed' || b.status === 'cancelled' || b.status === 'expired') && (
        <p className="rounded-[10px] bg-surface-muted px-3.5 py-3 text-[13px] text-muted">
          This booking is {STATUS_LABELS[b.status].toLowerCase()}. No further actions are possible.
        </p>
      )}
    </div>
  );

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title="Booking details" className="mb-5" />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid min-w-0 gap-5 lg:col-span-8">
          <section className="card overflow-hidden">
            <VenueBanner venueId={b.venue.id} rounded={false} className="h-[84px]" />
            <div className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div className="min-w-0">
                <h2 className="font-display text-[19px] font-semibold leading-[26px] text-ink">{b.venue.name}</h2>
                <p className="tabular mt-1 text-[13px] text-muted">
                  Reference <span className="font-mono font-medium text-ink">{b.reference}</span> · Submitted {formatTimestamp(b.createdAt, tz)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(b.status === 'confirmed' || b.status === 'queued') && <StartsInChip date={b.date} today={now?.date} />}
                <StatusBadge status={b.status} queuePosition={b.queuePosition} />
              </div>
            </div>
            <div className="px-5 pb-5">
              <StatusCallout b={asBooking} meId={me.id} tz={tz} />
            </div>
          </section>

          <section className="card p-5">
            <p className="eyebrow mb-3">Requester</p>
            <div className="flex flex-wrap items-center gap-4">
              <UserAvatar name={b.requester.fullName} role={b.requester.role} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[16px] font-semibold text-ink">{b.requester.fullName}</p>
                  <RoleBadge role={b.requester.role} />
                  {!b.requester.isActive && <Pill>Inactive</Pill>}
                </div>
                <p className="truncate text-[13px] text-muted">{b.requester.email}</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  {ROLE_LABELS[b.requester.role]}
                  {b.requester.department ? ` · ${b.requester.department}` : ''} · Other bookings: {b.requester.stats.totalBookings} total, {b.requester.stats.upcomingBookings} upcoming
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link to={`/admin/users/${b.requester.id}`}>View user</Link>
              </Button>
            </div>
          </section>

          <SectionCard title="Booking details" bodyClassName="grid gap-x-6 sm:grid-cols-2">
            <InfoRow icon={Building2} label="Venue">
              <Link to={`/admin/venues/${b.venue.id}`} className="font-semibold text-primary hover:underline">
                {b.venue.name}
              </Link>
              <span className="block text-[12.5px] text-muted">{b.venue.building}{!b.venue.isActive ? ' · Inactive' : ''}</span>
            </InfoRow>
            <InfoRow icon={CalendarDays} label={b.days > 1 ? 'Dates' : 'Date'}>
              <span className="tabular">{formatBookingLongDates(b)}</span>
            </InfoRow>
            <InfoRow icon={Clock} label="Time">
              <span className="tabular">
                {formatTimeRange(b.startTime, b.endTime)} · {formatDuration(b.durationMinutes)}
                {b.days > 1 ? ' daily' : ''}
              </span>
            </InfoRow>
            <InfoRow icon={IdCard} label="USN / Faculty ID">
              <span className="font-mono">{b.idNumber ?? 'Not recorded'}</span>
            </InfoRow>
            <InfoRow icon={UsersRound} label="Expected attendees">
              <span className="tabular">{b.expectedAttendees ? `${formatNumber(b.expectedAttendees)} of ${formatNumber(b.venue.capacity)} capacity` : `Not specified (capacity ${formatNumber(b.venue.capacity)})`}</span>
            </InfoRow>
            <div className="sm:col-span-2">
              <InfoRow icon={NotebookPen} label="Purpose">
                <span className="whitespace-pre-line">{b.purpose}</span>
              </InfoRow>
            </div>
          </SectionCard>

          <SectionCard title="Activity">
            <Timeline history={b.history} timeZone={tz} meId={me.id} />
          </SectionCard>
        </div>

        <aside className="hidden lg:col-span-4 lg:block">
          <div className="card sticky top-[88px] p-5">
            <p className="eyebrow mb-3">Actions</p>
            {panel}
          </div>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-[6px] safe-bottom lg:hidden">
        <div className="mx-auto max-w-[1400px] [&>.grid]:grid-cols-2 [&>.grid>p]:col-span-2">{panel}</div>
      </div>
      <CancelBookingDialog booking={cancelling ? b : null} onClose={() => setCancelling(false)} onDone={() => setCancelling(false)} />
    </div>
  );
}
