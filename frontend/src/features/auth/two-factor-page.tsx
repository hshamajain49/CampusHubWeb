// Super Admin two-step verification (security/AUDIT.md F-02): set up an authenticator app once, then enter its
// 6-digit code after each sign-in. The API refuses every admin request until this session has passed the step.
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Copy, Download, KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import type { MfaRecoveryCodes, MfaSetup } from '@campushub/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { safeRedirect } from '@/lib/navigation';
import { useDocumentTitle } from '@/hooks/misc';
import { canAccess, roleHome, twoFactorHold, useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Checkbox } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PasswordInput } from './password-input';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function Header({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="mb-4 grid size-12 place-items-center rounded-[14px] bg-primary-soft text-primary [&_svg]:size-6">{icon}</div>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">{title}</h1>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </>
  );
}

/** One-time code input: digits only for TOTP, letters too for recovery codes. */
function CodeInput({ recovery, ...props }: React.ComponentProps<typeof Input> & { recovery: boolean }) {
  return (
    <Input
      {...props}
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={recovery ? 11 : 6}
      placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
      className="font-mono text-[17px] tracking-[0.2em]"
    />
  );
}

export function TwoFactorPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const enrolled = !!profile?.mfa.enrolled;
  useDocumentTitle(enrolled ? 'Two-step verification' : 'Set up two-step verification');
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /** Done: fetch the verified profile and go where the user was heading. */
  const finish = React.useCallback(async () => {
    twoFactorHold.current = false;
    const me = await refreshProfile();
    const target = safeRedirect(params.get('redirectTo'));
    navigate(me && target && canAccess(me.role, target) ? target : me ? roleHome(me.role) : '/', { replace: true });
  }, [navigate, params, refreshProfile]);

  React.useEffect(() => () => void (twoFactorHold.current = false), []);

  return (
    <div>
      {enrolled ? <Verify onDone={finish} /> : <Enrol onDone={finish} />}
      <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => void signOut('signed_out')}>
        <LogOut /> Sign out
      </Button>
    </div>
  );
}

// ─────────────────────────── verify (every sign-in) ───────────────────────────
function Verify({ onDone }: { onDone: () => Promise<void> }) {
  const [recovery, setRecovery] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError(recovery ? 'Enter a recovery code.' : 'Enter the 6-digit code.');
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ usedRecoveryCode: boolean; recoveryCodesLeft: number }>('/me/mfa/verify', { method: 'POST', body: { code } });
      if (r.usedRecoveryCode) {
        const msg = `Recovery code used. ${r.recoveryCodesLeft} left.`;
        if (r.recoveryCodesLeft < 3) toast.warning(`${msg} Generate new ones from your profile.`);
        else toast.success(msg);
      }
      await onDone();
    } catch (err) {
      setError(errorText(err));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header icon={<ShieldCheck />} title="Two-step verification">
        {recovery ? 'Enter one of the recovery codes you saved when you set this up. Each works once.' : 'Enter the 6-digit code from your authenticator app.'}
      </Header>
      <form onSubmit={submit} noValidate className="mt-6 grid gap-4">
        <Field label={recovery ? 'Recovery code' : 'Code'} error={error ?? undefined}>
          {(p) => <CodeInput {...p} ref={inputRef} recovery={recovery} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">
          <ShieldCheck /> Verify
        </Button>
        <Button
          type="button"
          variant="link"
          className="justify-self-center"
          onClick={() => {
            setRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
        </Button>
      </form>
    </>
  );
}

// ─────────────────────────── enrol (once) ───────────────────────────
function Enrol({ onDone }: { onDone: () => Promise<void> }) {
  const [setup, setSetup] = React.useState<MfaSetup | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  if (setup) {
    return (
      <Scan
        setup={setup}
        onExpired={() => setSetup(null)}
        onEnabled={(c) => {
          twoFactorHold.current = true; // the session is verified now; stay here until the codes are saved
          setCodes(c);
        }}
      />
    );
  }
  return <ConfirmPassword onReady={setSetup} />;
}

function ConfirmPassword({ onReady }: { onReady: (s: MfaSetup) => void }) {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      onReady(await apiFetch<MfaSetup>('/me/mfa/setup', { method: 'POST', body: { password } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header icon={<Smartphone />} title="Set up two-step verification">
        Super Admin accounts need a second step at sign-in: a code from an authenticator app such as Google Authenticator,
        Microsoft Authenticator or 1Password. Confirm your password to start.
      </Header>
      <form onSubmit={submit} noValidate className="mt-6 grid gap-4">
        <Field label="Password" error={error ?? undefined}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">
          <KeyRound /> Continue
        </Button>
      </form>
    </>
  );
}

function Scan({ setup, onEnabled, onExpired }: { setup: MfaSetup; onEnabled: (codes: string[]) => void; onExpired: () => void }) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // An <img> never runs script inside the SVG, so the server's QR markup is shown without innerHTML.
  const qrSrc = React.useMemo(() => `data:image/svg+xml;base64,${btoa(setup.qrSvg)}`, [setup.qrSvg]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the app.');
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<MfaRecoveryCodes>('/me/mfa/enable', { method: 'POST', body: { code: code.trim() } });
      onEnabled(r.recoveryCodes);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_SETUP_EXPIRED') {
        toast.error(err.message);
        return onExpired();
      }
      setError(errorText(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header icon={<Smartphone />} title="Scan with your authenticator app">
        Add an account in the app by scanning this code, then enter the 6-digit code it shows.
      </Header>
      <div className="mt-5 grid justify-items-center gap-3">
        <img src={qrSrc} alt="QR code to add CampusHub to your authenticator app" className="size-48 rounded-[12px] border border-border bg-white p-1" />
        <details className="w-full text-[13px] text-muted">
          <summary className="cursor-pointer select-none text-primary">Can't scan? Enter the key instead</summary>
          <div className="mt-2 flex items-center gap-2 rounded-[10px] bg-surface-muted px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{setup.secret}</code>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Copy key"
              onClick={() => void navigator.clipboard?.writeText(setup.secret.replace(/\s+/g, '')).then(() => toast.success('Key copied.'))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-1.5">Time-based, 6 digits, every 30 seconds.</p>
        </details>
      </div>
      <form onSubmit={submit} noValidate className="mt-5 grid gap-4">
        <Field label="Code from the app" error={error ?? undefined}>
          {(p) => <CodeInput {...p} recovery={false} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">
          <ShieldCheck /> Turn on two-step verification
        </Button>
      </form>
    </>
  );
}

/** The recovery codes with Copy and Download (shown once, after enabling or regenerating). */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  const text = `CampusHub recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campushub-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[12px] border border-border bg-surface-muted px-4 py-3 font-mono text-[14px] text-ink">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('Codes copied.'))}>
          <Copy /> Copy
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  return (
    <>
      <Header icon={<KeyRound />} title="Save your recovery codes">
        If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, like a password
        manager. They won't be shown again.
      </Header>
      <div className="mt-5">
        <RecoveryCodeList codes={codes} />
      </div>
      <label className="mt-5 flex items-start gap-2.5 text-sm text-ink">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} className="mt-0.5" />
        I've saved these codes somewhere safe.
      </label>
      {!saved && (
        <Alert variant="warning" className="mt-3">
          Without them, a lost phone locks you out until the team that runs CampusHub resets your two-step verification.
        </Alert>
      )}
      <Button
        type="button"
        size="lg"
        className="mt-4 w-full"
        disabled={!saved}
        loading={busy}
        onClick={() => {
          setBusy(true);
          void onDone().finally(() => setBusy(false));
        }}
      >
        <ShieldCheck /> Continue
      </Button>
    </>
  );
}
