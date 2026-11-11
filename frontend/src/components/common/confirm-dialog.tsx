// Shared confirm dialog (§8.6): submit shows a spinner and disables both buttons, errors render inline,
// the dialog stays open on error, and destructive confirmations focus the safe button by default.
import * as React from 'react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  size,
  hideCancel = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
  size?: 'md' | 'lg';
  hideCancel?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        busy={busy}
        size={size}
        role={destructive ? 'alertdialog' : 'dialog'}
        onOpenAutoFocus={(e) => {
          if (destructive) {
            e.preventDefault();
            cancelRef.current?.focus();
          }
        }}
      >
        <form onSubmit={run} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          {error && <Alert variant="error">{error}</Alert>}
          <DialogFooter>
            {!hideCancel && (
              <Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                {cancelLabel}
              </Button>
            )}
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={busy} disabled={confirmDisabled || busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
