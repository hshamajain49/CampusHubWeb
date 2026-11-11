import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, MailCheck, Send } from 'lucide-react';
import { passwordSchema } from '@campushub/shared';
import { authClient } from '@/lib/auth-client';
import { useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { EmptyState } from '@/components/common/states';
import { authErrorMessage } from './lib/auth-error-messages';
import { PasswordInput } from './password-input';

const emailForm = z.object({ email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')) });

export function ForgotPasswordPage() {
  useDocumentTitle('Reset your password');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof emailForm>>({ resolver: zodResolver(emailForm), mode: 'onTouched', defaultValues: { email: '' } });

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (email: string) => {
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    if (err && (err.status === 429 || err.status === 0)) return setError(authErrorMessage(err as any));
    setSentTo(email); // always neutral: no account enumeration (UW-03)
    setCooldown(60);
  };

  if (sentTo) {
    return (
      <div className="text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-secondary-soft text-secondary-text">
          <MailCheck className="size-8" />
        </div>
        <h1 className="mt-5 font-display text-[20px] font-semibold text-ink">Check your inbox</h1>
        <p className="mt-2 text-sm leading-5 text-muted">
          If an account exists for <span className="font-semibold text-ink">{sentTo}</span>, a password reset link is on its way. Check your inbox and spam folder.
        </p>
        {error && <Alert variant="error" className="mt-4 text-left">{error}</Alert>}
        <div className="mt-6 grid gap-2">
          <Button variant="outline" disabled={cooldown > 0} onClick={() => void send(sentTo)}>
            <Send /> {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/login" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">Enter your account email and we'll send you a reset link.</p>
      <form onSubmit={form.handleSubmit((v) => send(v.email))} noValidate className="mt-6 grid gap-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" {...form.register('email')} />}
        </Field>
        {error && <Alert variant="error">{error}</Alert>}
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          <Send /> Send reset link
        </Button>
      </form>
    </div>
  );
}

const resetForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function InvalidLink() {
  return (
    <EmptyState
      compact
      icon={KeyRound}
      tone="danger"
      title="This reset link is invalid or has expired."
      message="Reset links work once and expire after an hour."
      action={
        <Button asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      }
    />
  );
}

export function ResetPasswordPage() {
  useDocumentTitle('Set a new password');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Read the token once, then drop it from the address bar so it isn't kept in history (U04).
  const [token] = React.useState(() => params.get('token'));
  const [invalid, setInvalid] = React.useState(() => !params.get('token') || params.get('error') === 'INVALID_TOKEN');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (params.get('token')) window.history.replaceState(null, '', '/reset-password');
  }, [params]);

  const form = useForm<z.infer<typeof resetForm>>({ resolver: zodResolver(resetForm), mode: 'onTouched', defaultValues: { password: '', confirm: '' } });
  if (invalid || !token) return <InvalidLink />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: err } = await authClient.resetPassword({ newPassword: v.password, token });
    if (err) {
      const code = (err as any).code;
      if (code === 'INVALID_TOKEN' || /token/i.test(err.message ?? '')) return setInvalid(true);
      if (code === 'WEAK_PASSWORD' || code === 'PASSWORD_TOO_SHORT') return form.setError('password', { message: authErrorMessage(err as any) });
      return setError(authErrorMessage(err as any));
    }
    toast.success('Your password has been reset. Sign in with your new password.');
    navigate('/login', { replace: true });
  });

  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">Set a new password</h1>
      <p className="mt-1 text-sm text-muted">Choose a password you don't use anywhere else.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4">
        <Field label="New password" error={form.formState.errors.password?.message} hint="At least 8 characters, with a letter and a number.">
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
        </Field>
        {error && <Alert variant="error">{error}</Alert>}
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full">
          <KeyRound /> Set new password
        </Button>
      </form>
    </div>
  );
}
