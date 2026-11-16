// Permanent account deletion (docs/ACCOUNTS.md): password + typed DELETE, then sign out to the login page.
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAuth, useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/form-field';
import { SectionCard } from '@/components/common/layout-bits';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

function useDeleteAccount() {
  return useMutation({
    mutationFn: (body: { password: string; confirm: string }) =>
      apiFetch<{ bookingsDeleted: number; complaintsDeleted: number; suggestionsDeleted: number }>('/me', { method: 'DELETE', body }),
  });
}

export function DeleteAccountCard() {
  const me = useMe();
  const { signOut } = useAuth();
  const del = useDeleteAccount();
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setPassword('');
      setTyped('');
    }
  }, [open]);
  const admin = me.role === 'super_admin';

  return (
    <SectionCard title="Delete account">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">
          Permanently delete your account and your data. This can't be undone.
          {admin ? ' The last Super Admin cannot delete their account.' : ''}
        </p>
        <Button variant="destructive-outline" onClick={() => setOpen(true)} className="shrink-0">
          <Trash2 /> Delete account
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        size="lg"
        title="Delete your account permanently?"
        confirmLabel="Delete my account"
        cancelLabel="Keep my account"
        confirmDisabled={typed !== 'DELETE' || !password}
        onConfirm={async () => {
          // A wrong password or LAST_SUPER_ADMIN throws; the dialog shows the message and stays open.
          await del.mutateAsync({ password, confirm: typed });
          setOpen(false);
          await signOut('account_deleted', { callApi: false });
        }}
      >
        <div className="grid gap-2 text-[13px] text-ink">
          <p className="font-semibold">This deletes, for good:</p>
          <ul className="ml-4 list-disc space-y-1 text-muted">
            <li>your profile, sign-in and notification settings;</li>
            <li>your bookings (upcoming ones are cancelled first, so anyone queued for that time gets it);</li>
            <li>the complaints you reported, with their photos, and your suggestions;</li>
            <li>your notifications.</li>
          </ul>
          <p className="text-muted">
            Kept, without your name: entries in other people's booking and complaint timelines (shown as "Deleted user"), and one
            anonymous audit record that an account was deleted.
          </p>
        </div>
        <Field label="Your password">
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label={'Type DELETE to confirm'}>
          {(p) => <Input {...p} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />}
        </Field>
      </ConfirmDialog>
    </SectionCard>
  );
}
