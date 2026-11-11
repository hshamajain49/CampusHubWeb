import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, KeyRound, LogOut, Mail, Save, Smartphone } from 'lucide-react';
import { departmentSchema, fullNameSchema, type Me } from '@campushub/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { formatDate, formatTimestamp } from '@/lib/format';
import type { PushState } from '@/lib/push';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { useAuth, useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Switch } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PageHeader, SectionCard } from '@/components/common/layout-bits';
import { RoleBadge } from '@/components/common/badges';
import { UserAvatar } from '@/components/common/small';
import { PasswordInput } from '@/features/auth/password-input';
import { changePasswordForm, submitPasswordChange, type ChangePasswordValues } from '@/features/auth/change-password-page';

function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<Me>('/me', { method: 'PATCH', body }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}

function EditProfile({ me }: { me: Me }) {
  const admin = me.role === 'super_admin';
  const schema = z.object({ fullName: fullNameSchema, department: z.union([departmentSchema, z.literal('')]) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), mode: 'onTouched', values: { fullName: me.fullName, department: me.department ?? '' } });
  const update = useUpdateMe();
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await update.mutateAsync(admin ? { fullName: v.fullName } : { fullName: v.fullName, department: v.department || null });
      toast.success('Profile updated.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });
  return (
    <SectionCard title="Edit profile">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={form.formState.errors.fullName?.message}>
            {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
          </Field>
          {!admin && (
            <Field label="Department" optional error={form.formState.errors.department?.message}>
              {(p) => <Input {...p} {...form.register('department')} />}
            </Field>
          )}
        </div>
        <div>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
            <Save /> Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ChangePassword() {
  const form = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordForm), mode: 'onTouched', defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await submitPasswordChange(v, (f, m) => form.setError(f as any, { message: m }));
    if (ok) {
      form.reset();
      toast.success('Password updated.');
    }
  });
  return (
    <SectionCard title="Change password">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Current password" error={errors.currentPassword?.message}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('currentPassword')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" error={errors.newPassword?.message} hint="At least 8 characters, with a letter and a number.">
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('newPassword')} />}
          </Field>
          <Field label="Confirm new password" error={errors.confirm?.message}>
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
          </Field>
        </div>
        {errors.root?.message && <Alert variant="error">{errors.root.message}</Alert>}
        <p className="text-[12.5px] text-muted">After the change, your other devices are signed out.</p>
        <div>
          <Button type="submit" loading={isSubmitting}>
            <KeyRound /> Update password
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  on: 'Push notifications are on for this device',
  off: 'Push notifications are off for this device',
  denied: 'Notifications are blocked in your browser settings',
  unsupported: 'Push notifications are not supported by this browser',
  unconfigured: 'Push notifications are not set up on this server',
  'ios-install': 'To get notifications on iPhone or iPad, add this site to your Home Screen (Share → Add to Home Screen), then open it from there.',
};

function Notifications({ me }: { me: Me }) {
  const update = useUpdateMe();
  const { data: settings } = usePublicSettings();
  const [push, setPush] = React.useState<PushState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const admin = me.role === 'super_admin';

  React.useEffect(() => {
    let alive = true;
    import('@/lib/push').then(async (m) => {
      const s = await m.pushState(settings?.pushPublicKey ?? null).catch(() => 'unsupported' as PushState);
      if (alive) setPush(s);
      if (s === 'on') void m.resyncPush(settings?.pushPublicKey ?? null);
    });
    return () => {
      alive = false;
    };
  }, [settings?.pushPublicKey]);

  const togglePush = async () => {
    setBusy(true);
    try {
      const m = await import('@/lib/push');
      if (push === 'on') {
        await m.disablePush();
        setPush('off');
        toast.success('Notifications turned off on this device.');
      } else {
        const s = await m.enablePush(settings!.pushPublicKey!);
        setPush(s);
        if (s === 'on') toast.success('Notifications are on for this device.');
        if (s === 'denied') toast.error('Notifications are blocked in your browser settings.');
      }
    } catch {
      toast.error("Couldn't change notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Notifications">
      <div className="grid gap-5">
        <label className="flex items-start justify-between gap-4">
          <span className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary">
              <Mail className="size-[18px]" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">{admin ? 'Email me about new and changed requests' : 'Email me about my bookings'}</span>
              <span className="block text-[12.5px] text-muted">In-app notifications are always on.</span>
            </span>
          </span>
          <Switch
            checked={me.emailNotifications}
            disabled={update.isPending}
            onCheckedChange={(c) =>
              update.mutate({ emailNotifications: c }, { onSuccess: () => toast.success(c ? 'Email notifications on.' : 'Email notifications off.') })
            }
          />
        </label>
        <div className="flex flex-col gap-3 rounded-[12px] border border-border p-4 sm:flex-row sm:items-center">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-secondary-soft text-secondary-text">
            {push === 'on' ? <BellRing className="size-[18px]" /> : <Smartphone className="size-[18px]" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">This device</p>
            <p className="text-[12.5px] leading-[18px] text-muted">{push ? PUSH_TEXT[push] : 'Checking…'}</p>
          </div>
          {(push === 'on' || push === 'off') && (
            <Button variant={push === 'on' ? 'outline' : 'default'} loading={busy} onClick={togglePush}>
              {push === 'on' ? 'Turn off on this device' : 'Enable notifications on this device'}
            </Button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function ProfilePage() {
  useDocumentTitle('Profile');
  const me = useMe();
  const { signOut } = useAuth();
  const { data: settings } = usePublicSettings();
  const tz = settings?.campusTimezone ?? 'UTC';
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="Profile & settings" />
      <div className="grid gap-5">
        <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <UserAvatar name={me.fullName} role={me.role} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[19px] font-semibold text-ink">{me.fullName}</h2>
              <RoleBadge role={me.role} />
            </div>
            <p className="truncate text-sm text-muted">{me.email}</p>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
              {me.department && (
                <div>
                  <dt className="inline">Department </dt>
                  <dd className="inline font-semibold text-ink">{me.department}</dd>
                </div>
              )}
              <div>
                <dt className="inline">Member since </dt>
                <dd className="inline font-semibold text-ink">{formatDate(me.createdAt.slice(0, 10))}</dd>
              </div>
              {me.lastSignInAt && (
                <div>
                  <dt className="inline">Last sign-in </dt>
                  <dd className="tabular inline font-semibold text-ink">{formatTimestamp(me.lastSignInAt, tz)}</dd>
                </div>
              )}
            </dl>
          </div>
        </section>
        <EditProfile me={me} />
        <ChangePassword />
        <Notifications me={me} />
        <SectionCard title="Session">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted">
              To change your email, contact the administrator. Need to change your email or close your account? Contact the administrator
              {settings?.supportEmail ? (
                <>
                  {' at '}
                  <a href={`mailto:${settings.supportEmail}`} className="font-semibold text-primary hover:underline">
                    {settings.supportEmail}
                  </a>
                </>
              ) : null}
              .
            </p>
            <Button variant="outline" onClick={() => void signOut('signed_out')}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
