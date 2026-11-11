// D-06 deactivate, D-07 activate, D-08 delete, D-15 remove photo, plus the Photo card.
import * as React from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import type { AdminVenue } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Alert, Checkbox } from '@/components/ui/controls';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/form-field';
import { SectionCard } from '@/components/common/layout-bits';
import { VenueBanner } from '@/components/common/venue-visuals';
import { useVenueMutations } from '../api';

export type VenueDialog = 'deactivate' | 'activate' | 'delete' | 'remove-photo' | null;

export function VenueDialogs({ venue, dialog, onClose }: { venue: AdminVenue; dialog: VenueDialog; onClose: () => void }) {
  const m = useVenueMutations();
  const navigate = useNavigate();
  const [cancelAll, setCancelAll] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    setCancelAll(false);
    setReason('');
    setTyped('');
  }, [dialog]);
  const upcoming = venue.stats.upcomingApprovedCount + venue.stats.pendingCount;
  const close = (o: boolean) => !o && onClose();

  return (
    <>
      <ConfirmDialog
        open={dialog === 'deactivate'}
        onOpenChange={close}
        destructive
        title={`Deactivate ${venue.name}?`}
        description="Members will no longer see or book this venue. Existing approved bookings remain valid unless you cancel them."
        confirmLabel="Deactivate venue"
        confirmDisabled={cancelAll && reason.trim().length < 3}
        onConfirm={async () => {
          const r = await m.deactivate.mutateAsync({ id: venue.id, body: { cancelUpcomingBookings: cancelAll, ...(cancelAll ? { reason: reason.trim() } : {}) } });
          const n = r.affected.rejected + r.affected.cancelled;
          toast.success(n ? `Venue deactivated. ${n} booking${n === 1 ? ' was' : 's were'} cancelled or rejected.` : 'Venue deactivated.');
        }}
      >
        {upcoming > 0 && (
          <div className="grid gap-3 rounded-[12px] border border-border p-3.5">
            <p className="tabular text-[13px] font-semibold text-ink">
              {venue.stats.upcomingApprovedCount} approved and {venue.stats.pendingCount} pending upcoming bookings
            </p>
            <label className="flex items-start gap-2.5 text-[13px] text-ink">
              <Checkbox checked={cancelAll} onCheckedChange={(c) => setCancelAll(!!c)} className="mt-0.5" />
              Also cancel approved bookings and reject pending requests
            </label>
            {cancelAll && (
              <Field label="Reason (shown to requesters)" error={reason && reason.trim().length < 3 ? 'Reason must be 3–200 characters' : undefined}>
                {(p) => <Textarea {...p} rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Closed for renovation until January." />}
              </Field>
            )}
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'activate'}
        onOpenChange={close}
        title={`Activate ${venue.name}?`}
        description="Members will be able to see and book it again."
        confirmLabel="Activate venue"
        onConfirm={async () => {
          await m.activate.mutateAsync(venue.id);
          toast.success('Venue activated.');
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        destructive
        title={`Delete ${venue.name}?`}
        description="This permanently removes the venue and its blocks."
        confirmLabel="Delete venue"
        confirmDisabled={typed.trim() !== venue.name}
        onConfirm={async () => {
          await m.remove.mutateAsync(venue.id);
          toast.success('Venue deleted.');
          navigate('/admin/venues', { replace: true });
        }}
      >
        <Field label={`Type “${venue.name}” to confirm`}>
          {(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'remove-photo'}
        onOpenChange={close}
        destructive
        title="Remove the photo?"
        description={`Remove the photo of ${venue.name}? Members will see the coloured banner instead.`}
        confirmLabel="Remove photo"
        onConfirm={async () => {
          await m.removeImage.mutateAsync(venue.id);
          toast.success('Photo removed.');
        }}
      />
    </>
  );
}

export function PhotoCard({ venue, onRemove }: { venue: AdminVenue; onRemove: () => void }) {
  const m = useVenueMutations();
  const input = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setError('Use a JPEG, PNG or WebP image.');
    if (file.size > 5 * 1024 * 1024) return setError('The image must be 5 MB or smaller.');
    const url = URL.createObjectURL(file);
    setPreview(url);
    try {
      await m.uploadImage.mutateAsync({ id: venue.id, file });
      toast.success('Photo updated.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The image service didn't respond. Please try again.");
    } finally {
      setPreview(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <SectionCard title="Photo">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)] sm:items-center">
        <VenueBanner venueId={venue.id} imageUrl={preview ?? venue.imageUrl} alt={venue.name} className="aspect-video w-full">
          {!venue.imageUrl && !preview && (
            <span className="absolute left-3 top-3 rounded-full bg-black/25 px-2 py-0.5 text-[12px] font-semibold text-white">No photo yet</span>
          )}
        </VenueBanner>
        <div className="grid gap-2">
          <p className="text-[13px] text-muted">JPEG, PNG or WebP up to 5 MB. Photos are resized to at most 1600 px. Saving happens right away.</p>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Choose a venue photo" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={m.uploadImage.isPending} onClick={() => input.current?.click()}>
              {venue.imageUrl ? <Upload /> : <ImagePlus />} {venue.imageUrl ? 'Replace photo' : 'Upload photo'}
            </Button>
            {venue.imageUrl && (
              <Button variant="destructive-outline" onClick={onRemove}>
                <Trash2 /> Remove photo
              </Button>
            )}
          </div>
          {error && <Alert variant="error">{error}</Alert>}
        </div>
      </div>
    </SectionCard>
  );
}
