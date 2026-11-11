import * as React from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Save } from 'lucide-react';
import { VENUE_TYPES, VENUE_TYPE_LABELS, type AdminVenue, type VenueType } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { SectionCard } from '@/components/common/layout-bits';
import { AmenityChip } from '@/components/common/venue-visuals';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

const SUGGESTIONS = ['Projector', 'Whiteboard', 'AC', 'Wi-Fi', 'Microphone', 'Sound system', 'Stage', 'Computers'];

const schema = z.object({
  name: z.string().trim().min(1, 'Required').min(2, 'Name must be 2–120 characters').max(120, 'Name must be 2–120 characters'),
  venueType: z.enum(VENUE_TYPES),
  building: z.string().trim().min(1, 'Required').max(120, 'Building must be at most 120 characters'),
  locationDetails: z.string().trim().max(200, 'Location must be at most 200 characters'),
  capacity: z
    .number({ message: 'Required' })
    .int('Enter a whole number between 1 and 100,000')
    .min(1, 'Enter a whole number between 1 and 100,000')
    .max(100_000, 'Enter a whole number between 1 and 100,000'),
  description: z.string().trim().min(1, 'Required').max(2000, 'Description must be at most 2000 characters'),
  amenities: z.array(z.string()).max(20),
});
type Values = z.infer<typeof schema>;

function AmenitiesInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    let next = [...value];
    for (const p of parts) {
      if (p.length > 40) {
        setError('Amenities must be 1–40 characters');
        continue;
      }
      if (next.length >= 20) {
        setError('Add at most 20 amenities');
        break;
      }
      if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next = [...next, p];
    }
    onChange(next);
    setDraft('');
  };
  return (
    <div className="grid gap-3">
      <Field label="Amenities" hint="Press Enter or type a comma to add. Up to 20." error={error ?? undefined}>
        {(p) => (
          <Input
            {...p}
            value={draft}
            placeholder="e.g. Projector"
            enterKeyHint="done"
            onChange={(e) => {
              setError(null);
              if (e.target.value.includes(',')) add(e.target.value);
              else setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (draft.trim()) add(draft);
              }
              if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => draft.trim() && add(draft)}
          />
        )}
      </Field>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((a) => (
            <AmenityChip key={a} name={a} onRemove={() => onChange(value.filter((x) => x !== a))} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-muted">Suggestions:</span>
        {SUGGESTIONS.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => add(s)}
            className="chip press inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[#C5CDDC] px-2.5 text-[12px] font-semibold text-muted hover:border-secondary hover:text-secondary-text"
          >
            <Plus className="size-3" /> {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VenueForm({
  venue,
  submitLabel,
  onSubmit,
}: {
  venue?: AdminVenue;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<string>;
}) {
  const navigate = useNavigate();
  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: venue?.name ?? '',
      venueType: (venue?.venueType ?? 'other') as VenueType,
      building: venue?.building ?? '',
      locationDetails: venue?.locationDetails ?? '',
      capacity: venue?.capacity ?? (undefined as unknown as number),
      description: venue?.description ?? '',
      amenities: venue?.amenities ?? [],
    },
  });
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && !done && !isSubmitting && currentLocation.pathname !== nextLocation.pathname);

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      name: v.name,
      venueType: v.venueType,
      building: v.building,
      locationDetails: v.locationDetails || null,
      capacity: v.capacity,
      description: v.description,
      amenities: v.amenities,
    };
    if (venue) for (const k of Object.keys(body)) if (!(dirtyFields as Record<string, unknown>)[k]) delete body[k];
    try {
      const id = await onSubmit(body);
      setDone(true);
      navigate(`/admin/venues/${id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VENUE_NAME_TAKEN') return form.setError('name', { message: 'A venue with this name already exists.' });
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors).length) {
        for (const [f, m] of Object.entries(e.fieldErrors)) form.setError(f as keyof Values, { message: m[0] });
        return;
      }
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <SectionCard title="Venue details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message} className="sm:col-span-2">
            {(p) => <Input {...p} maxLength={120} {...form.register('name')} />}
          </Field>
          <Field label="Type">
            {(p) => (
              <Controller
                control={form.control}
                name="venueType"
                render={({ field }) => (
                  <Select id={p.id} value={field.value} onValueChange={field.onChange} options={VENUE_TYPES.map((t) => ({ value: t, label: VENUE_TYPE_LABELS[t] }))} />
                )}
              />
            )}
          </Field>
          <Field label="Capacity" error={errors.capacity?.message}>
            {(p) => (
              <Controller
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    className="tabular"
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 6);
                      field.onChange(d ? Number(d) : undefined);
                    }}
                  />
                )}
              />
            )}
          </Field>
          <Field label="Building" error={errors.building?.message}>
            {(p) => <Input {...p} maxLength={120} {...form.register('building')} />}
          </Field>
          <Field label="Location details" optional error={errors.locationDetails?.message}>
            {(p) => <Input {...p} maxLength={200} placeholder="e.g. 2nd floor, Room A-204" {...form.register('locationDetails')} />}
          </Field>
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={4} maxLength={2000} {...form.register('description')} />}
          </Field>
        </div>
      </SectionCard>
      <SectionCard title="Amenities">
        <Controller control={form.control} name="amenities" render={({ field }) => <AmenitiesInput value={field.value} onChange={(v) => field.onChange(v)} />} />
      </SectionCard>
      {formError && <Alert variant="error">{formError}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end max-md:sticky max-md:bottom-0 max-md:-mx-4 max-md:border-t max-md:border-border max-md:bg-surface max-md:px-4 max-md:pt-3 max-md:safe-bottom">
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!!venue && !isDirty}>
          <Save /> {submitLabel}
        </Button>
      </div>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard changes?"
        description="Your edits will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </form>
  );
}
