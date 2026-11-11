import * as React from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BellRing, Building2, CalendarDays, Clock, NotebookPen, UsersRound } from 'lucide-react';
import { formatLongDate, formatTimeRange } from '@/lib/format';
import { readPref, writePref } from '@/lib/session-token';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { StatusBadge } from '@/components/common/badges';
import { CopyButton } from '@/components/common/small';
import { ErrorState } from '@/components/common/states';
import { useBooking } from './api';

function SuccessCheck() {
  return (
    <div className="relative mx-auto grid size-[72px] place-items-center">
      <span aria-hidden className="motion-safe-only absolute inset-0 rounded-full bg-success/25" style={{ animation: 'ring-out 900ms var(--ease-out) 150ms both' }} />
      <span className="pop-in-once relative grid size-[72px] place-items-center rounded-full bg-success text-white shadow-[0_8px_24px_rgba(31,157,99,0.35)]">
        <svg viewBox="0 0 24 24" className="size-9" fill="none" aria-hidden>
          <path
            d="M5 12.5l4.2 4.2L19 7"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="28"
            className="motion-safe-only"
            style={{ animation: 'check-draw 380ms var(--ease-out) 220ms both' }}
          />
        </svg>
      </span>
    </div>
  );
}

function PushPrompt() {
  const { data: settings } = usePublicSettings();
  const [hidden, setHidden] = React.useState(() => readPref('pushPrompt.dismissed') === '1');
  const [busy, setBusy] = React.useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hidden || !supported || !settings?.pushPublicKey || Notification.permission !== 'default') return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#C9D5F2] bg-primary-soft/60 p-3.5 text-left">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-primary">
        <BellRing className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-[13px] font-medium text-[#1F2F66]">Get notified on this device when it's decided</p>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            writePref('pushPrompt.dismissed', '1');
            setHidden(true);
          }}
        >
          Not now
        </Button>
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { enablePush } = await import('@/lib/push');
              const state = await enablePush(settings.pushPublicKey!);
              if (state === 'denied') toast.error('Notifications are blocked in your browser settings.');
              else if (state === 'on') toast.success('Notifications are on for this device.');
              setHidden(true);
            } catch {
              toast.error("Couldn't turn on notifications. Try again from your profile.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Turn on
        </Button>
      </div>
    </div>
  );
}

export function BookingSubmittedPage() {
  const { bookingId } = useParams();
  const q = useBooking(bookingId);
  useDocumentTitle('Booking requested');
  const [firstStatus] = React.useState(() => q.data?.status);

  if (q.isLoading) return <Skeleton className="mx-auto h-[560px] max-w-[560px] rounded-[18px]" />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const b = q.data!;
  // Reloaded later, after a decision: show the details page instead.
  if (b.status !== 'pending' && firstStatus !== 'pending') return <Navigate to={`/bookings/${b.id}`} replace />;

  const rows = [
    { icon: Building2, label: 'Venue', value: b.venue.name },
    { icon: CalendarDays, label: 'Date', value: formatLongDate(b.date) },
    { icon: Clock, label: 'Time', value: formatTimeRange(b.startTime, b.endTime) },
    { icon: NotebookPen, label: 'Purpose', value: b.purpose },
    { icon: UsersRound, label: 'Attendees', value: b.expectedAttendees ? String(b.expectedAttendees) : 'Not specified' },
  ];

  return (
    <div className="mx-auto max-w-[560px] py-2">
      <article className="relative overflow-hidden rounded-[18px] border border-border bg-surface shadow-raised">
        <div className="px-6 pb-7 pt-8 text-center sm:px-8">
          <SuccessCheck />
          <h1 className="mt-5 font-display text-[24px] font-semibold leading-8 text-ink">Booking requested!</h1>
          <p className="mx-auto mt-2 max-w-[420px] text-sm leading-[22px] text-muted">
            Your request has been sent to the administrator for review. We'll notify you when it's decided. You can also track it under My bookings.
          </p>
          <div className="mt-5">
            <PushPrompt />
          </div>
        </div>

        {/* Perforated tear line with notches — the booking "pass". */}
        <div aria-hidden className="relative h-6">
          <span className="absolute -left-3 top-0 size-6 rounded-full border border-border bg-background" />
          <span className="absolute -right-3 top-0 size-6 rounded-full border border-border bg-background" />
          <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-border" />
        </div>

        <div className="px-6 pb-7 pt-3 sm:px-8">
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-muted px-4 py-3">
            <div>
              <p className="eyebrow">Reference</p>
              <p className="mt-0.5 font-mono text-[17px] font-semibold tracking-[0.02em] text-ink">{b.reference}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={b.status} />
              <CopyButton value={b.reference} label="Copy reference" />
            </div>
          </div>
          <dl className="mt-4 grid gap-0.5">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2 text-sm">
                <dt className="flex items-center gap-2 text-muted">
                  <r.icon className="size-4" aria-hidden /> {r.label}
                </dt>
                <dd className="tabular min-w-0 break-words font-medium text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button asChild size="lg">
              <Link to={`/bookings/${b.id}`}>View booking</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/venues">Book another venue</Link>
            </Button>
          </div>
          <div className="mt-4 text-center">
            <Link to="/dashboard" className="text-[13px] font-semibold text-primary hover:underline">
              Go to dashboard
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
