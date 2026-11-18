// Super Admin profile: two-step verification status and new recovery codes (security/AUDIT.md F-02).
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { Me, MfaRecoveryCodes } from '@campushub/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { SectionCard } from '@/components/common/layout-bits';
import { RecoveryCodeList } from '@/features/auth/two-factor-page';

export function TwoStepCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const left = me.mfa.recoveryCodesLeft ?? 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<MfaRecoveryCodes>('/me/mfa/recovery-codes', { method: 'POST', body: { code: code.trim() } });
      setCodes(r.recoveryCodes);
      setOpen(false);
      setCode('');
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('New recovery codes created. The old ones no longer work.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Two-step verification">
      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="text-[13px] leading-5">
            <p className="font-semibold text-ink">On: a code from your authenticator app is needed at every sign-in.</p>
            <p className="text-muted">
              {left} recovery code{left === 1 ? '' : 's'} left.
              {left < 3 && ' Generate new ones so a lost phone doesn’t lock you out.'}
            </p>
          </div>
        </div>
        {codes && (
          <div className="grid gap-2">
            <Alert variant="warning">Save these now. They won't be shown again.</Alert>
            <RecoveryCodeList codes={codes} />
          </div>
        )}
        {open ? (
          <form onSubmit={submit} noValidate className="grid gap-3 sm:max-w-[320px]">
            <Field label="Code from your authenticator app" error={error ?? undefined}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="font-mono tracking-[0.2em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                <RefreshCw /> Generate new codes
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setOpen(true)}>
              <RefreshCw /> New recovery codes
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
