// Complaint dialogs CDG-01…CDG-11 (§8.4). Each runs one action; a conflict (someone else changed the complaint, or the
// window closed) closes the dialog, toasts the server's message and refetches, so the page shows the current state.
import * as React from 'react';
import { toast } from 'sonner';
import { CLOSURE_TYPE_LABELS, CLOSURE_TYPES, type ClosureType, type Complaint } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, RadioCards } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PhotoUploader } from './photo-uploader';
import { useComplaintAction, useComplaintCategories, useCompleteWork, type ComplaintScope } from '../api';

const STALE_CODES = new Set(['COMPLAINT_CHANGED', 'INVALID_STATUS_TRANSITION', 'REOPEN_WINDOW_CLOSED', 'COMPLAINT_NOT_FOUND']);
const len = (s: string) => [...s.trim()].length; // code points, like PostgreSQL char_length (CEC-28)

/** Runs an action; stale-state errors close the dialog with a toast and refetch, others stay inline. */
async function guarded(run: () => Promise<unknown>, onStale: () => void, close: () => void) {
  try {
    await run();
  } catch (err) {
    if (err instanceof ApiError && STALE_CODES.has(err.code)) {
      toast.error(err.message);
      close();
      onStale();
      return;
    }
    throw err;
  }
}

/** What the simple dialogs need — a list row (ComplaintSummary) is enough. */
type Mini = Pick<Complaint, 'id' | 'version' | 'reference' | 'department' | 'category'>;

interface Base {
  c: Mini;
  scope: ComplaintScope;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStale: () => void;
}

/** Shared shape for "a note/reason, then one action" dialogs. */
function TextActionDialog({
  c,
  scope,
  open,
  onOpenChange,
  onStale,
  action,
  title,
  description,
  label,
  placeholder,
  min = 0,
  max,
  confirmLabel,
  destructive,
  success,
  bodyKey,
  extra,
  extraBody,
}: Base & {
  action: string;
  title: string;
  description?: React.ReactNode;
  label: string;
  placeholder?: string;
  min?: number;
  max: number;
  confirmLabel: string;
  destructive?: boolean;
  success: string;
  bodyKey: 'reason' | 'note';
  extra?: React.ReactNode;
  extraBody?: Record<string, unknown>;
}) {
  const [text, setText] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const act = useComplaintAction(scope, c.id);
  React.useEffect(() => {
    if (open) {
      setText('');
      setTouched(false);
    }
  }, [open]);
  const n = len(text);
  const tooShort = min > 0 && n < min;
  const error =
    touched && tooShort
      ? bodyKey === 'reason' && action === 'reject'
        ? 'Please tell us what still needs fixing (at least 3 characters).'
        : `Please write at least ${min} characters.`
      : n > max
        ? `Keep it under ${max} characters.`
        : undefined;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive={destructive}
      confirmDisabled={n > max}
      onConfirm={async () => {
        setTouched(true);
        if (tooShort) throw new Error(min >= 3 ? 'Please write at least 3 characters.' : 'Please check the form.');
        await guarded(
          async () => {
            await act.mutateAsync({ action, body: { version: c.version, [bodyKey]: text.trim() || null, ...extraBody } });
            toast.success(success);
          },
          onStale,
          () => onOpenChange(false),
        );
      }}
    >
      {extra}
      <Field label={label} optional={min === 0} error={error} hint={<span className="tabular">{n}/{max}</span>}>
        {(p) => (
          <Textarea {...p} rows={3} autoGrow maxRows={8} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} placeholder={placeholder} />
        )}
      </Field>
    </ConfirmDialog>
  );
}

// CDG-01
export function ApproveDialog({ c, scope, open, onOpenChange, onStale }: Base) {
  const act = useComplaintAction(scope, c.id);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark this complaint as resolved?"
      description={`The ${c.department.name} will see your approval.`}
      confirmLabel="Approve"
      onConfirm={() =>
        guarded(
          async () => {
            await act.mutateAsync({ action: 'approve', body: { version: c.version } });
            toast.success('Thanks! The complaint is now resolved.');
          },
          onStale,
          () => onOpenChange(false),
        )
      }
    />
  );
}

// CDG-02 [SRC]
export const RejectDialog = (p: Base) => (
  <TextActionDialog
    {...p}
    action="reject"
    bodyKey="reason"
    title="What still needs fixing?"
    description={`Your note goes back to the ${p.c.department.name}.`}
    label="What still needs fixing?"
    placeholder="e.g. The projector still flickers"
    min={3}
    max={300}
    confirmLabel="Send back"
    success="Sent back to the department for more work."
  />
);

// CDG-03
export const WithdrawDialog = (p: Base) => (
  <TextActionDialog
    {...p}
    action="withdraw"
    bodyKey="reason"
    title="Withdraw this complaint?"
    description="The department will stop working on it. This can't be undone."
    label="Reason"
    placeholder="e.g. Filed by mistake"
    max={300}
    confirmLabel="Withdraw"
    destructive
    success="Complaint withdrawn."
  />
);

// CDG-04
export const StartWorkDialog = (p: Base) => (
  <TextActionDialog
    {...p}
    action="start"
    bodyKey="note"
    title={`Start working on ${p.c.reference}?`}
    description="You'll be shown as the handler."
    label="Note to the reporter"
    placeholder="e.g. Will check it after 2 pm."
    max={500}
    confirmLabel="Start work"
    success="Work started."
  />
);

// CDG-06
export const ReopenDialog = (p: Base) => (
  <TextActionDialog
    {...p}
    action="reopen"
    bodyKey="note"
    title="Reopen this resolved complaint?"
    label="Note"
    placeholder="e.g. The fan stopped again."
    max={500}
    confirmLabel="Reopen"
    success="Complaint reopened."
  />
);

// CDG-11 (option D)
export const ReporterReopenDialog = (p: Base) => (
  <TextActionDialog
    {...p}
    action="reopen"
    bodyKey="reason"
    title="Still not fixed?"
    description={`This complaint was resolved automatically. Tell the ${p.c.department.name} what's still wrong.`}
    label="What's still wrong?"
    placeholder="e.g. The fan stopped working again"
    min={3}
    max={300}
    confirmLabel="Reopen complaint"
    success="Complaint reopened and sent back to the department."
  />
);

// CDG-07
export function RequestReassignmentDialog(p: Base) {
  const cats = useComplaintCategories();
  const [suggested, setSuggested] = React.useState('');
  React.useEffect(() => {
    if (p.open) setSuggested('');
  }, [p.open]);
  const options = (cats.data ?? []).filter((x) => x.id !== p.c.category.id).map((x) => ({ value: x.id, label: `${x.name} → ${x.department.name}` }));
  return (
    <TextActionDialog
      {...p}
      action="request-reassignment"
      bodyKey="reason"
      title="Request reassignment"
      description="The administrator will move it to the right department. It stays in your queue, flagged, until then."
      label="Why doesn't this belong to your department?"
      placeholder="e.g. This is a water leak, not electrical."
      min={3}
      max={500}
      confirmLabel="Send request"
      success="Reassignment requested."
      extraBody={{ suggestedCategoryId: suggested || null }}
      extra={
        <Field label="Suggested category" optional>
          {(f) => (
            <Select
              id={f.id}
              value={suggested}
              onValueChange={setSuggested}
              placeholder="No suggestion"
              options={options}
            />
          )}
        </Field>
      }
    />
  );
}

// CDG-05
export function CompleteWorkDialog({ c, scope, open, onOpenChange, onStale }: Omit<Base, 'c'> & { c: Complaint; scope: 'staff' | 'admin' }) {
  const [note, setNote] = React.useState('');
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [round, setRound] = React.useState(0);
  const complete = useCompleteWork(scope, c.id);
  React.useEffect(() => {
    if (open) {
      setNote('');
      setPhotos([]);
      setProgress(null);
      setRound((r) => r + 1); // fresh uploader each time
    }
  }, [open]);
  const room = Math.max(0, 3 - c.attachments.resolution.length);
  const n = len(note);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Mark work as done"
      confirmLabel={progress !== null && progress < 1 ? `Uploading photos… ${Math.round(progress * 100)} %` : 'Mark as done'}
      confirmDisabled={busy || n > 1000}
      onConfirm={() =>
        guarded(
          async () => {
            await complete.mutateAsync({ version: c.version, note: note.trim() || null, photos, onProgress: photos.length ? setProgress : undefined });
            toast.success("Marked as done — waiting for the reporter's approval.");
          },
          onStale,
          () => onOpenChange(false),
        )
      }
    >
      <Field label="What was done?" optional hint={<span className="tabular">{n}/1000</span>} error={n > 1000 ? 'Keep it under 1000 characters.' : undefined}>
        {(p) => <Textarea {...p} rows={3} autoGrow maxRows={8} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the fan regulator" />}
      </Field>
      {room > 0 ? (
        <div className="grid gap-1.5">
          <p className="text-[13px] font-semibold text-ink">
            "After" photos <span className="font-normal text-subtle">(optional)</span>
          </p>
          <PhotoUploader
            key={round}
            max={room}
            onChange={(files, compressing) => {
              setPhotos(files);
              setBusy(compressing);
            }}
          />
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">This complaint already has 3 "after" photos.</p>
      )}
      <Alert variant="info">{c.reporter.fullName} will be asked to approve the fix.</Alert>
    </ConfirmDialog>
  );
}

// CDG-08 (+ CA-5 dismiss)
export function ReassignDialog({ c, open, onOpenChange, onStale }: Omit<Base, 'scope' | 'c'> & { c: Complaint }) {
  const cats = useComplaintCategories();
  const act = useComplaintAction('admin', c.id);
  const [categoryId, setCategoryId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setCategoryId(c.reassignmentSuggestedCategory?.id ?? '');
      setNote('');
      setTouched(false);
    }
  }, [open, c.reassignmentSuggestedCategory?.id]);
  const options = (cats.data ?? []).filter((x) => x.id !== c.category.id).map((x) => ({ value: x.id, label: `${x.name} → ${x.department.name}` }));
  const n = len(note);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reassign complaint"
      confirmLabel="Reassign"
      confirmDisabled={n > 500}
      onConfirm={async () => {
        setTouched(true);
        if (!categoryId || n < 3) throw new Error('Choose a new category and add a note.');
        await guarded(
          async () => {
            await act.mutateAsync({ action: 'reassign', body: { version: c.version, categoryId, note: note.trim() } });
            toast.success('Complaint reassigned.');
          },
          onStale,
          () => onOpenChange(false),
        );
      }}
    >
      {c.reassignmentRequested && c.reassignmentNote && (
        <Alert variant="info" title="Staff request">
          {c.reassignmentNote}
        </Alert>
      )}
      <Field label="New category" error={touched && !categoryId ? 'Choose a category' : undefined} hint="The category decides the department.">
        {(p) => <Select id={p.id} invalid={!!p['aria-invalid']} value={categoryId} onValueChange={setCategoryId} placeholder="Choose a category" options={options} />}
      </Field>
      <Field label="Note" error={touched && n < 3 ? 'Please add a note (at least 3 characters).' : n > 500 ? 'Keep it under 500 characters.' : undefined} hint={<span className="tabular">{n}/500</span>}>
        {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Water leak — moved to Plumbing." />}
      </Field>
      <Alert variant="info">The complaint returns to Pending Review in the new department.</Alert>
    </ConfirmDialog>
  );
}

export const DismissReassignmentDialog = (p: Omit<Base, 'scope'>) => (
  <TextActionDialog
    {...p}
    scope="admin"
    action="reassign"
    bodyKey="note"
    title="Dismiss the reassignment request?"
    description="The complaint stays with its current department."
    label="Note"
    placeholder="e.g. Electrical issue after all."
    min={3}
    max={500}
    confirmLabel="Dismiss request"
    success="Reassignment request dismissed."
    extraBody={{ dismiss: true }}
  />
);

// CDG-09
export function CloseDialog({ c, open, onOpenChange, onStale }: Omit<Base, 'scope' | 'c'> & { c: Complaint }) {
  const act = useComplaintAction('admin', c.id);
  const [type, setType] = React.useState<ClosureType | ''>('');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setType('');
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const n = len(reason);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      size="lg"
      title="Close this complaint?"
      description={`${c.reporter.fullName} will see this reason. Closing is final.`}
      confirmLabel="Close complaint"
      confirmDisabled={n > 500}
      onConfirm={async () => {
        setTouched(true);
        if (!type || n < 3) throw new Error('Choose a reason type and explain why.');
        await guarded(
          async () => {
            await act.mutateAsync({ action: 'close', body: { version: c.version, closureType: type, reason: reason.trim() } });
            toast.success('Complaint closed.');
          },
          onStale,
          () => onOpenChange(false),
        );
      }}
    >
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold text-ink">Reason type</p>
        <RadioCards aria-label="Reason type" value={type} onValueChange={(v) => setType(v as ClosureType)} options={CLOSURE_TYPES.map((t) => ({ value: t, label: CLOSURE_TYPE_LABELS[t] }))} />
        {touched && !type && <p className="text-[12.5px] font-medium text-destructive-text">Choose a reason type</p>}
      </div>
      <Field label="Explanation" error={touched && n < 3 ? 'Please explain why (at least 3 characters).' : n > 500 ? 'Keep it under 500 characters.' : undefined} hint={<span className="tabular">{n}/500</span>}>
        {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Same issue as CMP-2026-000041." />}
      </Field>
    </ConfirmDialog>
  );
}
