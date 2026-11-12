// D-05: create/edit a venue block. Step 2 appears only after 409 BLOCK_CONFLICT and lists the affected bookings.
import * as React from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Construction } from 'lucide-react';
import { BLOCK_TYPES, BLOCK_TYPE_LABELS, addDays, buildTimeOptions, type BlockConflict, type BlockType, type VenueBlock } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { formatShortDay, formatTimeRange } from '@/lib/format';
import { useCampusNow } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, Switch } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common/form-field';
import { DatePicker } from '@/components/common/pickers';
import { StatusBadge } from '@/components/common/badges';
import { useAllVenueOptions, useBlockMutations } from '../api';

const TIMES = buildTimeOptions('00:00', '23:45', 15);

export interface BlockDialogInitial {
  venueId?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  /** Pre-filled reason, e.g. from a complaint about the venue. */
  reason?: string;
}

export function BlockDialog({
  open,
  onOpenChange,
  block,
  initial,
  lockVenue = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  block?: VenueBlock | null;
  initial?: BlockDialogInitial;
  lockVenue?: boolean;
}) {
  const now = useCampusNow();
  const venues = useAllVenueOptions();
  const m = useBlockMutations();
  const [venueId, setVenueId] = React.useState('');
  const [type, setType] = React.useState<BlockType>('maintenance');
  const [reason, setReason] = React.useState('');
  const [allDay, setAllDay] = React.useState(false);
  const [sd, setSd] = React.useState('');
  const [st, setSt] = React.useState('09:00');
  const [ed, setEd] = React.useState('');
  const [et, setEt] = React.useState('17:00');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [conflicts, setConflicts] = React.useState<BlockConflict[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setConflicts(null);
    if (block) {
      setVenueId(block.venue.id);
      setType(block.blockType);
      setReason(block.reason);
      const s = block.start.slice(11, 16);
      const e = block.end.slice(11, 16);
      const isAllDay = s === '00:00' && e === '00:00';
      setAllDay(isAllDay);
      setSd(block.start.slice(0, 10));
      setSt(s);
      setEd(isAllDay ? addDays(block.end.slice(0, 10), -1) : block.end.slice(0, 10));
      setEt(e);
    } else {
      const today = now?.date ?? '';
      setVenueId(initial?.venueId ?? '');
      setType('maintenance');
      setReason(initial?.reason?.slice(0, 200) ?? '');
      setAllDay(false);
      setSd(initial?.startDate ?? today);
      setSt(initial?.startTime ?? '09:00');
      setEd(initial?.endDate ?? initial?.startDate ?? today);
      setEt(initial?.endTime ?? '17:00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.id]);

  const range = () => (allDay ? { start: `${sd}T00:00:00`, end: `${addDays(ed, 1)}T00:00:00` } : { start: `${sd}T${st}:00`, end: `${ed}T${et}:00` });

  const submit = async (resolution: 'abort' | 'cancel_conflicting') => {
    const errs: Record<string, string> = {};
    if (!venueId) errs.venue = 'Choose a venue';
    if (reason.trim().length < 3 || reason.trim().length > 200) errs.reason = 'Reason must be 3–200 characters';
    if (!sd) errs.start = 'Pick a start date';
    if (!ed) errs.end = 'Pick an end date';
    const r = range();
    if (sd && ed && r.end <= r.start) errs.end = 'The end must be after the start';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = { blockType: type, reason: reason.trim(), start: r.start, end: r.end, conflictResolution: resolution };
      const res = block ? await m.update.mutateAsync({ id: block.id, body }) : await m.create.mutateAsync({ ...body, venueId });
      const a = res.affectedBookings;
      toast.success(
        a.rejected + a.cancelled > 0
          ? `Block saved. ${a.rejected + a.cancelled} booking${a.rejected + a.cancelled === 1 ? ' was' : 's were'} cancelled or rejected.`
          : block
            ? 'Block updated.'
            : 'Block created.',
      );
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'BLOCK_CONFLICT' && e.details?.conflicts?.length) setConflicts(e.details.conflicts);
      else if (e instanceof ApiError && e.code === 'BLOCK_OVERLAP') setErrors({ start: 'This overlaps an existing block. Edit that block instead.' });
      else if (e instanceof ApiError && e.code === 'BLOCK_IN_PAST') setErrors({ end: 'A block must end in the future.' });
      else setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const venueName = venues.data?.data.find((v) => v.id === venueId)?.name;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent busy={busy} size="lg">
        {conflicts ? (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>
                {conflicts.length} booking{conflicts.length === 1 ? '' : 's'} overlap this block
              </DialogTitle>
              <DialogDescription>
                Blocking will reject pending requests and cancel approved bookings with the reason “Venue unavailable: {BLOCK_TYPE_LABELS[type]} — {reason.trim()}”.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid max-h-64 gap-2 overflow-y-auto">
              {conflicts.map((c) => (
                <li key={c.bookingId} className="flex items-center gap-3 rounded-[10px] bg-surface-muted px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink">
                      <span className="font-mono">{c.reference}</span> · {c.requester.fullName}
                    </p>
                    <p className="tabular text-[12.5px] text-muted">
                      {formatShortDay(c.date)} · {formatTimeRange(c.startTime, c.endTime)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} size="sm" />
                </li>
              ))}
            </ul>
            {formError && <Alert variant="error">{formError}</Alert>}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setConflicts(null)}>
                <ArrowLeft /> Change time
              </Button>
              <Button variant="destructive" loading={busy} onClick={() => submit('cancel_conflicting')}>
                Block and cancel {conflicts.length} booking{conflicts.length === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit('abort');
            }}
          >
            <DialogHeader>
              <DialogTitle>{block ? 'Edit block' : 'Block this venue'}</DialogTitle>
              <DialogDescription>Members see the reason on the calendar and can't book this time.</DialogDescription>
            </DialogHeader>
            {!lockVenue && !block ? (
              <Field label="Venue" error={errors.venue}>
                {(p) => (
                  <Select
                    id={p.id}
                    invalid={!!p['aria-invalid']}
                    value={venueId}
                    onValueChange={setVenueId}
                    placeholder="Choose a venue"
                    options={(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
                  />
                )}
              </Field>
            ) : (
              <p className="flex items-center gap-2 rounded-[10px] bg-surface-muted px-3 py-2.5 text-sm font-semibold text-ink">
                <Construction className="size-4 text-muted" /> {block?.venue.name ?? venueName}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Type">
                {(p) => <Select id={p.id} value={type} onValueChange={(v) => setType(v as BlockType)} options={BLOCK_TYPES.map((t) => ({ value: t, label: BLOCK_TYPE_LABELS[t] }))} />}
              </Field>
              <Field label="Reason (shown to members)" error={errors.reason}>
                {(p) => <Input {...p} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sound system replacement" />}
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3.5 py-2.5">
              <span className="text-sm font-semibold text-ink">All day</span>
              <Switch checked={allDay} onCheckedChange={setAllDay} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts" error={errors.start}>
                {(p) => (
                  <div className="grid gap-2" id={p.id}>
                    <DatePicker value={sd || null} onChange={(v) => {
                      setSd(v);
                      if (!ed || ed < v) setEd(v);
                    }} min={now?.date} />
                    {!allDay && <Select aria-label="Start time" value={st} onValueChange={setSt} options={TIMES.map((t) => ({ value: t, label: t }))} className="tabular" />}
                  </div>
                )}
              </Field>
              <Field label="Ends" error={errors.end}>
                {(p) => (
                  <div className="grid gap-2" id={p.id}>
                    <DatePicker value={ed || null} onChange={setEd} min={sd || now?.date} />
                    {!allDay && <Select aria-label="End time" value={et} onValueChange={setEt} options={TIMES.map((t) => ({ value: t, label: t }))} className="tabular" />}
                  </div>
                )}
              </Field>
            </div>
            {formError && <Alert variant="error">{formError}</Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                {block ? 'Save block' : 'Create block'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

