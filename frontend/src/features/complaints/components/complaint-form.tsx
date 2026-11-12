// The complaint form (§7, §8.3 CU02; CA03 for admins). Validation mirrors the API's: the server is authoritative and
// its field errors are mapped back onto the fields. One Idempotency-Key per form instance (CB-20, CEC-08).
import * as React from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Send, X } from 'lucide-react';
import { ROLE_LABELS, type ComplaintCategory, type VenueSummary } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { useMe } from '@/providers/auth-provider';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, Skeleton } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { SectionCard } from '@/components/common/layout-bits';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SectionError } from '@/components/common/states';
import { VenueCombobox } from '@/features/bookings/venue-combobox';
import { useVenue } from '@/features/venues/api';
import { useAllVenueOptions } from '@/features/admin/api';
import { CategoryPicker, RoutingHint } from './category-picker';
import { PhotoUploader } from './photo-uploader';
import { useComplaintCategories, useCreateComplaint } from '../api';

const len = (s: string) => [...s].length;

type Errors = Partial<Record<'categoryId' | 'title' | 'venueId' | 'locationDetails' | 'description' | 'photos', string>>;

/** Members search the venue list (E07); the admin picks from all active venues. */
function VenueField({ value, onChange, id, invalid, describedBy, isAdmin }: {
  value: string | null;
  onChange: (id: string | null) => void;
  id: string;
  invalid?: boolean;
  describedBy?: string;
  isAdmin: boolean;
}) {
  return isAdmin ? (
    <AdminVenueSelect value={value} onChange={onChange} id={id} invalid={invalid} />
  ) : (
    <MemberVenuePicker value={value} onChange={onChange} id={id} invalid={invalid} describedBy={describedBy} />
  );
}

function MemberVenuePicker({ value, onChange, id, invalid, describedBy }: { value: string | null; onChange: (id: string | null) => void; id: string; invalid?: boolean; describedBy?: string }) {
  const preset = useVenue(value ?? undefined);
  const [picked, setPicked] = React.useState<VenueSummary | null>(null);
  const current = value ? (picked?.id === value ? picked : (preset.data ?? null)) : null;
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <VenueCombobox
          id={id}
          invalid={invalid}
          describedBy={describedBy}
          value={current}
          onChange={(v) => {
            setPicked(v);
            onChange(v.id);
          }}
        />
      </div>
      {value && (
        <Button type="button" variant="ghost" size="icon" aria-label="Clear venue" onClick={() => onChange(null)}>
          <X />
        </Button>
      )}
    </div>
  );
}

function AdminVenueSelect({ value, onChange, id, invalid }: { value: string | null; onChange: (id: string | null) => void; id: string; invalid?: boolean }) {
  const venues = useAllVenueOptions();
  const options = [{ value: 'none', label: 'Not about a bookable venue' }, ...(venues.data?.data ?? []).filter((v) => v.isActive).map((v) => ({ value: v.id, label: v.name }))];
  return <Select id={id} invalid={invalid} value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)} options={options} />;
}

export function ComplaintForm({ initialVenueId, detailPath, cancelTo }: { initialVenueId?: string | null; detailPath: (id: string) => string; cancelTo: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const { data: settings } = usePublicSettings();
  const cats = useComplaintCategories();
  const create = useCreateComplaint();
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [venueId, setVenueId] = React.useState<string | null>(initialVenueId ?? null);
  const [location, setLocation] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [compressing, setCompressing] = React.useState(false);
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<React.ReactNode>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);
  const idempotencyKey = React.useRef(crypto.randomUUID());
  const categoryRef = React.useRef<HTMLDivElement>(null);

  const dirty = !!(categoryId || title || location || description || photos.length || (venueId && venueId !== (initialVenueId ?? null)));
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !done && !create.isPending && currentLocation.pathname !== nextLocation.pathname);
  const category: ComplaintCategory | undefined = cats.data?.find((c) => c.id === categoryId);
  const maxPhotos = settings?.complaintRules.maxPhotos ?? 3;

  const validate = (): Errors => {
    const e: Errors = {};
    if (!categoryId) e.categoryId = 'Please select a category';
    const t = title.trim();
    if (!t) e.title = 'Please give your complaint a title';
    else if (len(t) < 3) e.title = 'Title must be at least 3 characters.';
    else if (len(t) > 120) e.title = 'Title must be at most 120 characters.';
    if (len(location.trim()) > 200) e.locationDetails = 'Location must be at most 200 characters.';
    if (len(description.trim()) > 2000) e.description = 'Description must be at most 2000 characters.';
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.categoryId) categoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      const c = await create.mutateAsync({
        input: { categoryId: categoryId!, title: title.trim(), venueId, locationDetails: location.trim() || null, description: description.trim() || null },
        photos,
        idempotencyKey: idempotencyKey.current,
        onProgress: photos.length ? setProgress : undefined,
      });
      setDone(true);
      idempotencyKey.current = crypto.randomUUID();
      navigate(`${detailPath(c.id)}?submitted=1`, { replace: true });
    } catch (err) {
      setProgress(null);
      if (!(err instanceof ApiError)) return setFormError("Couldn't submit your complaint. Check your connection and try again.");
      if (err.code === 'NETWORK_ERROR') {
        toast.error("Couldn't submit your complaint. Check your connection and try again.");
        return;
      }
      if (err.code === 'VALIDATION_ERROR') {
        const fe = err.fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0]])) as Errors);
        return;
      }
      if (err.code === 'CATEGORY_INACTIVE') {
        setErrors({ categoryId: err.message });
        void cats.refetch();
        return;
      }
      if (err.code === 'VENUE_NOT_FOUND') return setErrors({ venueId: err.message });
      if (['TOO_MANY_FILES', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'IMAGE_UNREADABLE'].includes(err.code)) {
        const file = err.details?.file ? ` (${err.details.file})` : '';
        return setErrors({ photos: `${err.message}${file}` });
      }
      if (err.code === 'OPEN_COMPLAINT_LIMIT_REACHED') {
        return setFormError(
          <>
            {err.message}{' '}
            <Link to="/complaints" className="font-semibold underline">
              View my complaints
            </Link>
          </>,
        );
      }
      if (err.code === 'STORAGE_ERROR') return setFormError(`${err.message} You can also remove the photos and submit without them.`);
      setFormError(err.message);
    }
  };

  const uploading = progress !== null && progress < 1;
  const submitLabel = uploading ? `Uploading photos… ${Math.round(progress! * 100)} %` : 'Submit complaint';

  return (
    <form onSubmit={submit} noValidate className="mx-auto grid max-w-[760px] gap-5 pb-24 md:pb-0">
      <p className="text-sm text-muted">Tell us what's wrong — we'll route it to the right team.</p>

      <SectionCard title="What kind of issue is it?" bodyClassName="grid gap-3">
        <div ref={categoryRef}>
          {cats.isLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-[12px]" />
              ))}
            </div>
          ) : cats.isError ? (
            <SectionError onRetry={() => cats.refetch()} />
          ) : (
            <Field label={<span className="sr-only">Category</span>} error={errors.categoryId}>
              {(p) => (
                <CategoryPicker
                  id={p.id}
                  categories={cats.data ?? []}
                  value={categoryId}
                  onChange={(id) => {
                    setCategoryId(id);
                    setErrors((e) => ({ ...e, categoryId: undefined }));
                  }}
                  invalid={!!errors.categoryId}
                  describedBy={p['aria-describedby']}
                />
              )}
            </Field>
          )}
        </div>
        {category && <RoutingHint department={category.department.name} />}
      </SectionCard>

      <SectionCard title="Details" bodyClassName="grid gap-4">
        <Field label="Title" error={errors.title} hint={len(title) > 100 ? <span className="tabular">{len(title)}/120</span> : undefined}>
          {(p) => (
            <Input
              {...p}
              value={title}
              maxLength={140}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((x) => ({ ...x, title: undefined }));
              }}
              placeholder="e.g. Fan not working in Room 204"
            />
          )}
        </Field>
        <Field label="Is this about a bookable venue?" optional error={errors.venueId}>
          {(p) => <VenueField id={p.id} invalid={!!p['aria-invalid']} describedBy={p['aria-describedby']} value={venueId} onChange={setVenueId} isAdmin={me.role === 'super_admin'} />}
        </Field>
        <Field label="Location details" optional error={errors.locationDetails} hint="Building, floor, room or a landmark">
          {(p) => <Input {...p} value={location} maxLength={220} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Block A, Room 204" />}
        </Field>
        <Field label="Describe the issue" optional error={errors.description} hint={<span className="tabular">{len(description)}/2000</span>}>
          {(p) => (
            <Textarea {...p} rows={4} autoGrow maxRows={10} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any extra details that might help…" />
          )}
        </Field>
      </SectionCard>

      <SectionCard title="Photos (optional)">
        <PhotoUploader
          max={maxPhotos}
          disabled={create.isPending}
          error={errors.photos}
          onChange={(files, busy) => {
            setPhotos(files);
            setCompressing(busy);
            if (errors.photos) setErrors((x) => ({ ...x, photos: undefined }));
          }}
        />
      </SectionCard>

      <p className="text-[13px] text-muted">
        Reported by <span className="font-semibold text-ink">{me.fullName}</span> · {me.email} · {ROLE_LABELS[me.role]}
      </p>

      {formError && <Alert variant="error">{formError}</Alert>}

      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-[6px] safe-bottom md:static md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Button type="button" variant="outline" size="lg" className="max-md:hidden" onClick={() => navigate(cancelTo)}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="max-md:flex-1" loading={create.isPending} disabled={compressing || create.isPending}>
          <Send /> {compressing ? 'Preparing photos…' : submitLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard this complaint?"
        description="What you've entered will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </form>
  );
}
