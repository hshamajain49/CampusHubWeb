import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { canAccess, roleHome, useAuth } from '@/providers/auth-provider';
import { safeRedirect } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PasswordInput } from './password-input';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

const BANNERS: Record<string, { variant: 'info' | 'error'; text: string }> = {
  session_expired: { variant: 'info', text: 'Your session has expired. Please sign in again.' },
  deactivated: { variant: 'error', text: 'Your account has been deactivated. Contact an administrator.' },
};

export function LoginPage({ variant }: { variant: 'member' | 'admin' }) {
  const admin = variant === 'admin';
  useDocumentTitle(admin ? 'Administrator sign-in' : 'Sign in');
  const [params] = useSearchParams();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { data: settings } = usePublicSettings();
  const [error, setError] = React.useState<string | null>(null);
  const banner = BANNERS[params.get('reason') ?? ''];

  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: { email: params.get('email') ?? '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await signIn(v.email, v.password);
      if (me.mustChangePassword) return navigate('/change-password', { replace: true });
      const target = safeRedirect(params.get('redirectTo'));
      navigate(target && canAccess(me.role, target) ? target : roleHome(me.role), { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(msg);
      if (msg === 'Incorrect email or password.') {
        form.setValue('password', '');
        form.setFocus('password');
      }
    }
  });

  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">{admin ? 'Administrator sign-in' : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-muted">{admin ? 'Sign in to the CampusHub admin portal' : 'Sign in to continue to CampusHub'}</p>

      {banner && (
        <Alert variant={banner.variant} className="mt-5">
          {banner.text}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4">
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} {...form.register('email')} />}
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className="text-[13px] font-semibold text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('password')} />}
        </Field>
        {error && <Alert variant="error">{error}</Alert>}
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          <LogIn /> Sign in
        </Button>
      </form>

      {!admin && settings?.selfRegistrationEnabled && (
        <p className="mt-6 text-center text-sm text-muted">
          New here?{' '}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>
      )}
      {admin && (
        <p className="mt-6 text-center text-[13px] text-muted">
          Not an administrator?{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Member sign-in
          </Link>
        </p>
      )}
    </div>
  );
}
