import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { departmentSchema, domainAllowed, domainRestrictionMessage, emailSchema, fullNameSchema, passwordSchema } from '@campushub/shared';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch, ApiError } from '@/lib/api-client';
import { firstName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { EmptyState } from '@/components/common/states';
import { PasswordInput } from './password-input';

/** Stable empty list so the schema memo doesn't rebuild every render while settings load. */
const NO_DOMAINS: string[] = [];

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { data: settings, isLoading } = usePublicSettings();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const domains = settings?.allowedEmailDomains ?? NO_DOMAINS;

  const schema = React.useMemo(
    () =>
      z
        .object({
          fullName: fullNameSchema,
          email: emailSchema.refine((e) => domainAllowed(e, domains), domains.length ? domainRestrictionMessage(domains) : 'Enter a valid email'),
          department: z.union([departmentSchema, z.literal('')]),
          password: passwordSchema,
          confirm: z.string(),
        })
        .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] }),
    [domains],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: { fullName: '', email: '', department: '', password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  if (isLoading) return <Skeleton className="h-96" />;
  if (settings && !settings.selfRegistrationEnabled) {
    return (
      <EmptyState
        compact
        title="Registration is closed"
        message="Contact the administrator to get an account."
        action={
          <Button asChild variant="outline">
            <Link to="/login">Back to sign in</Link>
          </Button>
        }
      />
    );
  }

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: { fullName: v.fullName, email: v.email, password: v.password, department: v.department || null },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'EMAIL_ALREADY_REGISTERED' || e.code === 'EMAIL_DOMAIN_NOT_ALLOWED') return form.setError('email', { message: e.message });
        if (e.code === 'VALIDATION_ERROR') {
          for (const [f, msgs] of Object.entries(e.fieldErrors)) form.setError(f as keyof Values, { message: msgs[0] });
          return;
        }
        return setError(e.message);
      }
      return setError("Couldn't create your account. Please try again.");
    }
    try {
      await signIn(v.email, v.password);
      toast.success(`Welcome to CampusHub, ${firstName(v.fullName)}.`);
      navigate('/dashboard', { replace: true });
    } catch {
      toast('Account created. Please sign in.');
      navigate(`/login?email=${encodeURIComponent(v.email)}`, { replace: true });
    }
  });

  return (
    <div>
      <Link to="/login" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">Create account</h1>
      <p className="mt-1 text-sm text-muted">Register as a student to get started</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4">
        <Field label="Full name" error={errors.fullName?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email?.message} hint={domains.length ? `Use your college email (${domains.map((d) => `@${d}`).join(', ')})` : undefined}>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" {...form.register('email')} />}
        </Field>
        <Field label="Department" optional error={errors.department?.message}>
          {(p) => <Input {...p} autoComplete="organization-title" {...form.register('department')} />}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
        </Field>
        {error && <Alert variant="error">{error}</Alert>}
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          <UserPlus /> Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
