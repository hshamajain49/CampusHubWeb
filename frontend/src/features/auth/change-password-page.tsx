import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound, LogOut } from 'lucide-react';
import { passwordSchema } from '@campushub/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { roleHome, useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PasswordInput } from './password-input';

export const changePasswordForm = z
  .object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'New password must be different', path: ['newPassword'] })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
export type ChangePasswordValues = z.infer<typeof changePasswordForm>;

export async function submitPasswordChange(v: ChangePasswordValues, setError: (field: keyof ChangePasswordValues | 'root', msg: string) => void): Promise<boolean> {
  try {
    await apiFetch('/me/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_CURRENT_PASSWORD') setError('currentPassword', 'Current password is incorrect.');
    else if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && e.fieldErrors.newPassword) setError('newPassword', e.fieldErrors.newPassword[0]!);
    else setError('root', e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    return false;
  }
}

export function ChangePasswordPage() {
  useDocumentTitle('Choose a new password');
  const { refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const form = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordForm), mode: 'onTouched', defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await submitPasswordChange(v, (f, m) => form.setError(f as any, { message: m }));
    if (!ok) return;
    const me = await refreshProfile();
    toast.success('Password updated.');
    navigate(me ? roleHome(me.role) : '/', { replace: true });
  });

  return (
    <div>
      <div className="mb-4 grid size-12 place-items-center rounded-[14px] bg-primary-soft text-primary">
        <KeyRound className="size-6" />
      </div>
      <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">For your security, replace the temporary password you were given.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4">
        <Field label="Current (temporary) password" error={errors.currentPassword?.message}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('currentPassword')} />}
        </Field>
        <Field label="New password" error={errors.newPassword?.message} hint="At least 8 characters, with a letter and a number.">
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('newPassword')} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
        </Field>
        {errors.root?.message && <Alert variant="error">{errors.root.message}</Alert>}
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          <KeyRound /> Update password
        </Button>
        <Button type="button" variant="ghost" onClick={() => void signOut('signed_out')}>
          <LogOut /> Sign out
        </Button>
      </form>
    </div>
  );
}
