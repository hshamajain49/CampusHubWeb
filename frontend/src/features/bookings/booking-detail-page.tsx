import * as React from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { MoreHorizontal, Ban, Building2, CalendarDays, CalendarX2, Clock, Download, Hash, NotebookPen, Pencil, Repeat, UserRound, UsersRound } from 'lucide-react';
import type { Booking } from '@campushub/shared';
import { STATUS_LABELS } from '@campushub/shared';
import { isApiError, ApiError } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { formatDuration, formatLongDate, formatTimeRange, formatTimestamp, campusDateOf, formatDate, formatNumber } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menus';
import { Alert, Skeleton } from '@/components/ui/controls';
import { Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/common/badges';
import { InfoRow, PageHeader, SectionCard } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Timeline } from '@/components/common/timeline';
import { VenueBanner } from '@/components/common/venue-visuals';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/form-field';
import { TimingChip } from '@/components/common/booking-visuals';
import { useBooking, useCancelBooking } from './api';

export function StatusCallout({ b, meId, tz }: { b: Booking; meId: string; tz: string }) {
  switch (b.status) {
    case 'pending':
      return <Alert variant="warning">Awaiting review by the administrator. We'll notify you when it's decided.</Alert>;
    case 'approved':
      return (
        <Alert variant="success" title="Your booking is confirmed.">
          {b.approvalNote && <p className="mt-0.5 whitespace-pre-line">Note from the administrator: {b.approvalNote}</p>}
        </Alert>
      );
    case 'rejected':
      return (
        <Alert variant="error" title="Reason for rejection">
          <p className="whitespace-pre-line">{b.rejectionReason}</p>
        </Alert>
      );
    case 'cancelled': {
      const byMe = b.cancelledBy?.id === meId;
      const when = b.cancelledAt ? formatDate(campusDateOf(b.cancelledAt, tz)) : '';
      return (
        <Alert variant="info" icon={<Ban />} title={`Cancelled by ${byMe ? 'you' : 'the administrator'}${when ? ` on ${when}` : ''}`}>
          {b.cancellationReason && <p className="whitespace-pre-line">Reason: {b.cancellationReason}</p>}
        </Alert>
      );
    }
    case 'expired':
      return <Alert variant="warning">This request expired because it wasn't reviewed before its start time.</Alert>;
  }
}

function CancelDialog({ b, open, onOpenChange }: { b: Booking; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = React.useState('');
  const cancel = useCancelBooking(b.id);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title="Cancel this booking?"
      description="This cannot be undone. The venue will become available for others."
      cancelLabel="Keep booking"
      confirmLabel="Cancel booking"
      onConfirm={async () => {
        await cancel.mutateAsync({ reason: reason.trim() || undefined, version: b.version });
        toast.success('Booking cancelled.');
      }}
    >
      <Field label="Reason" optional hint={`${reason.length}/500`}>
        {(p) => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let the administrator know why (optional)" />}
      </Field>
    </ConfirmDialog>
  );
}

export function BookingDetailPage() {
  const { bookingId } = useParams();
  const me = useMe();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const q = useBooking(bookingId);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  useDocumentTitle(q.data ? `Booking ${q.data.reference}` : 'Booking');

  if (q.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid gap-4 lg:col-span-8">
          <Skeleton className="h-36 rounded-[14px]" />
          <Skeleton className="h-72 rounded-[14px]" />
        </div>
        <Skeleton className="h-56 rounded-[14px] lg:col-span-4" />
      </div>
    );
  }
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <div className="card">
        <EmptyState
          title="Booking not found"
          message="It may have been removed, or you may not have access."
          action={
            <Button asChild>
              <Link to="/bookings">My bookings</Link>
            </Button>
          }
        />
      </div>
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }

  const b = q.data!;
  const tz = settings?.campusTimezone ?? 'UTC';
  const p = b.permissions;
  const finalOrPast = !b.isUpcoming;
  const anyAction = p.canDownloadConfirmation || p.canEdit || p.canCancel || (p.canRebook && finalOrPast);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/bookings/${b.id}/confirmation.pdf`, `booking-confirmation-${b.reference}.pdf`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_STATUS_TRANSITION') void q.refetch();
    } finally {
      setDownloading(false);
    }
  };

  type Action = { key: string; label: string; icon: React.ReactNode; variant: 'default' | 'outline' | 'destructive-outline'; to?: string; onClick?: () => void; loading?: boolean };
  const items: Action[] = [];
  if (p.canDownloadConfirmation) items.push({ key: 'pdf', label: 'Download confirmation', icon: <Download />, variant: 'default', onClick: download, loading: downloading });
  if (p.canEdit) items.push({ key: 'edit', label: 'Edit booking', icon: <Pencil />, variant: 'outline', to: `/bookings/${b.id}/edit` });
  if (p.canCancel) items.push({ key: 'cancel', label: 'Cancel booking', icon: <CalendarX2 />, variant: 'destructive-outline', onClick: () => setCancelOpen(true) });
  if (p.canRebook && finalOrPast)
    items.push({ key: 'again', label: 'Book again', icon: <Repeat />, variant: 'outline', to: `/bookings/new?venueId=${b.venue.id}&purpose=${encodeURIComponent(b.purpose)}` });

  const renderButton = (a: Action, extra = '') =>
    a.to ? (
      <Button key={a.key} variant={a.variant} size="lg" asChild className={extra}>
        <Link to={a.to}>
          {a.icon} {a.label}
        </Link>
      </Button>
    ) : (
      <Button key={a.key} variant={a.variant} size="lg" onClick={a.onClick} loading={a.loading} className={extra}>
        {a.icon} {a.label}
      </Button>
    );

  const finalNote = (
    <p className="rounded-[10px] bg-surface-muted px-3.5 py-3 text-[13px] text-muted">
      This booking is {STATUS_LABELS[b.status].toLowerCase()} and can no longer be modified.
    </p>
  );
  const actions = <div className="grid gap-2">{anyAction ? items.map((a) => renderButton(a)) : finalNote}</div>;

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title="Booking details" breadcrumb={[{ label: 'My bookings', to: '/bookings' }, { label: b.reference }]} className="mb-5" />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid min-w-0 gap-5 lg:col-span-8">
          <section className="card overflow-hidden">
            <VenueBanner venueId={b.venue.id} rounded={false} className="h-[84px]" />
            <div className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div className="min-w-0">
                <h2 className="font-display text-[19px] font-semibold leading-[26px] text-ink">{b.venue.name}</h2>
                <p className="tabular mt-1 text-[13px] text-muted">
                  Reference <span className="font-mono font-medium text-ink">{b.reference}</span> · Requested {formatTimestamp(b.createdAt, tz)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <TimingChip booking={b} today={now?.date} />
                <StatusBadge status={b.status} />
              </div>
            </div>
            <div className="px-5 pb-5">
              <StatusCallout b={b} meId={me.id} tz={tz} />
            </div>
          </section>

          <SectionCard title="Booking details" bodyClassName="grid gap-x-6 sm:grid-cols-2">
            <InfoRow icon={Building2} label="Venue">
              {b.venue.isActive ? (
                <Link to={`/venues/${b.venue.id}`} className="font-semibold text-primary hover:underline">
                  {b.venue.name}
                </Link>
              ) : (
                b.venue.name
              )}
              <span className="block text-[12.5px] text-muted">
                {b.venue.building}
                {b.venue.locationDetails ? ` · ${b.venue.locationDetails}` : ''}
              </span>
            </InfoRow>
            <InfoRow icon={CalendarDays} label="Date">
              <span className="tabular">{formatLongDate(b.date)}</span>
            </InfoRow>
            <InfoRow icon={Clock} label="Time">
              <span className="tabular">
                {formatTimeRange(b.startTime, b.endTime)} · {formatDuration(b.durationMinutes)}
              </span>
            </InfoRow>
            <InfoRow icon={UsersRound} label="Expected attendees">
              <span className="tabular">{b.expectedAttendees ? `${formatNumber(b.expectedAttendees)} of ${formatNumber(b.venue.capacity)} capacity` : 'Not specified'}</span>
            </InfoRow>
            <div className="sm:col-span-2">
              <InfoRow icon={NotebookPen} label="Purpose">
                <span className="whitespace-pre-line">{b.purpose}</span>
              </InfoRow>
            </div>
            <InfoRow icon={UserRound} label="Requested by">
              {b.requester.fullName}
              <span className="block text-[12.5px] text-muted">{b.requester.email}</span>
            </InfoRow>
            <InfoRow icon={Hash} label="Reference">
              <span className="font-mono">{b.reference}</span>
            </InfoRow>
          </SectionCard>

          <SectionCard title="Activity">
            <Timeline history={b.history} timeZone={tz} meId={me.id} />
          </SectionCard>
        </div>

        <aside className="hidden lg:col-span-4 lg:block">
          <div className="card sticky top-[88px] p-5">
            <p className="eyebrow mb-3">Actions</p>
            {actions}
          </div>
        </aside>
      </div>

      {anyAction ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-[6px] safe-bottom lg:hidden">
          <div className="mx-auto flex max-w-[1200px] gap-2">
            {renderButton(items[0]!, 'flex-1')}
            {items.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className="w-12 px-0" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  {items.slice(1).map((a) =>
                    a.to ? (
                      <DropdownMenuItem key={a.key} asChild>
                        <Link to={a.to}>
                          {a.icon} {a.label}
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={a.key} destructive={a.variant === 'destructive-outline'} onSelect={a.onClick}>
                        {a.icon} {a.label}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 lg:hidden">{finalNote}</div>
      )}

      <CancelDialog b={b} open={cancelOpen} onOpenChange={setCancelOpen} />
    </div>
  );
}
