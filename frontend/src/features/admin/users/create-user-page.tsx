import * as React from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BriefcaseBusiness, GraduationCap, KeyRound, UserPlus, Wand2, Wrench } from 'lucide-react';
import { departmentSchema, domainAllowed, domainRestrictionMessage, emailSchema, fullNameSchema, passwordSchema } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, RadioCards } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common/form-field';
import { PageHeader, SectionCard } from '@/components/common/layout-bits';
import { CopyButton } from '@/components/common/small';
import { PasswordInput } from '@/features/auth/password-input';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useUserMutations } from '../api';
import { useServiceDepartments } from '@/features/complaints/api';

/** Stable empty list so the schema memo doesn't rebuild every render while settings load. */
const NO_DOMAINS: string[] = [];

/** 12 random letters and digits with at least 2 digits, from crypto.getRandomValues (A12). */
export function generatePassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string) => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return set[a[0]! % set.length]!;
  };
  const chars = [pick(digits), pick(digits), ...Array.from({ length: 10 }, () => pick(letters + digits))];
  for (let i = chars.length - 1; i > 0; i--) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const j = a[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export default function CreateUserPage() {
  useDocumentTitle('Create user');
  useAdminBreadcrumb([{ label: 'Users', to: '/admin/users' }, { label: 'New' }]);
  const navigate = useNavigate();
  const { data: settings } = usePublicSettings();
  const domains = settings?.allowedEmailDomains ?? NO_DOMAINS;
  const m = useUserMutations();
  const [created, setCreated] = React.useState<{ id: string; name: string; email: string; password: string } | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const schema = React.useMemo(
    () =>
      z.object({
        fullName: fullNameSchema,
        email: emailSchema.refine((e) => domainAllowed(e, domains), domains.length ? domainRestrictionMessage(domains) : 'Enter a valid email'),
        role: z.enum(['student', 'faculty_staff', 'department_staff']),
        department: z.union([departmentSchema, z.literal('')]),
        serviceDepartmentId: z.string(),
        temporaryPassword: passwordSchema,
      })
        .refine((v) => v.role !== 'department_staff' || !!v.serviceDepartmentId, {
          message: "Choose the staff member's department.",
          path: ['serviceDepartmentId'],
        }),
    [domains],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: { fullName: '', email: '', role: 'faculty_staff', department: '', serviceDepartmentId: '', temporaryPassword: '' } });
  const role = form.watch('role');
  const depts = useServiceDepartments();
  const { errors, isSubmitting } = form.formState;
  const pw = form.watch('temporaryPassword');

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const { serviceDepartmentId, ...rest } = v;
      const u = await m.create.mutateAsync({
        ...rest,
        department: v.department || null,
        ...(v.role === 'department_staff' ? { serviceDepartmentId } : {}),
      });
      setCreated({ id: u.id, name: u.fullName, email: u.email, password: v.temporaryPassword });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'EMAIL_ALREADY_REGISTERED' || e.code === 'EMAIL_DOMAIN_NOT_ALLOWED')) return form.setError('email', { message: e.message });
      if (e instanceof ApiError && e.code === 'SERVICE_DEPARTMENT_REQUIRED') return form.setError('serviceDepartmentId', { message: e.message });
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors).length) {
        for (const [f, msgs] of Object.entries(e.fieldErrors)) form.setError(f as keyof Values, { message: msgs[0] });
        return;
      }
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title="Create user" description="Admin-created accounts must choose a new password at first sign-in." />
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <SectionCard title="Account">
          <div className="grid gap-4">
            <Field label="Full name" error={errors.fullName?.message}>
              {(p) => <Input {...p} autoComplete="off" {...form.register('fullName')} />}
            </Field>
            <Field label="Email" error={errors.email?.message} hint={domains.length ? `Allowed domains: ${domains.map((d) => `@${d}`).join(', ')}` : undefined}>
              {(p) => <Input {...p} type="email" autoComplete="off" inputMode="email" autoCapitalize="none" {...form.register('email')} />}
            </Field>
            <Field
              label="Temporary password"
              error={errors.temporaryPassword?.message}
              hint="8–72 characters with a letter and a number."
              labelAction={pw ? <CopyButton value={pw} label="Copy password" /> : undefined}
            >
              {(p) => (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <PasswordInput {...p} autoComplete="new-password" {...form.register('temporaryPassword')} />
                  </div>
                  <Button type="button" variant="outline" onClick={() => form.setValue('temporaryPassword', generatePassword(), { shouldValidate: true, shouldDirty: true })}>
                    <Wand2 /> Generate
                  </Button>
                </div>
              )}
            </Field>
          </div>
        </SectionCard>
        <SectionCard title="Role & details">
          <div className="grid gap-4">
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <RadioCards
                  aria-label="Role"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: 'student', label: 'Student', description: 'Requests bookings for academic or club activities.', icon: <GraduationCap /> },
                    { value: 'faculty_staff', label: 'Faculty / Staff', description: 'Teaching, departmental or administrative use.', icon: <BriefcaseBusiness /> },
                    {
                      value: 'department_staff',
                      label: 'Department Staff',
                      description: "Works a service department's complaint queue; can also book venues.",
                      icon: <Wrench />,
                    },
                  ]}
                />
              )}
            />
            {role === 'department_staff' && (
              <Field label="Service department" error={errors.serviceDepartmentId?.message} hint="The complaint queue this person works.">
                {(p) => (
                  <Controller
                    control={form.control}
                    name="serviceDepartmentId"
                    render={({ field }) => (
                      <Select
                        id={p.id}
                        invalid={!!errors.serviceDepartmentId}
                        describedBy={p['aria-describedby']}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Choose a department"
                        options={(depts.data ?? []).filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))}
                      />
                    )}
                  />
                )}
              </Field>
            )}
            <Field label={role === 'department_staff' ? 'Academic department' : 'Department'} optional error={errors.department?.message}>
              {(p) => <Input {...p} {...form.register('department')} />}
            </Field>
          </div>
        </SectionCard>
        {formError && <Alert variant="error">{formError}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => navigate('/admin/users')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            <UserPlus /> Create account
          </Button>
        </div>
      </form>

      {/* D-12: can't be dismissed by clicking outside. */}
      <Dialog open={!!created}>
        <DialogContent dismissible={false} hideClose>
          <DialogHeader>
            <DialogTitle>Account created</DialogTitle>
            <DialogDescription>Share these credentials with {created?.name} securely:</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2">
            {(
              [
                ['Email', created?.email ?? ''],
                ['Temporary password', created?.password ?? ''],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-muted px-3.5 py-2.5">
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className="truncate font-mono text-[14px] font-semibold text-ink">{v}</dd>
                </div>
                <CopyButton value={v} label={`Copy ${k.toLowerCase()}`} />
              </div>
            ))}
          </dl>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <KeyRound className="mt-0.5 size-4 shrink-0" /> They'll be asked to choose a new password when they first sign in.
          </p>
          <DialogFooter>
            <Button onClick={() => created && navigate(`/admin/users/${created.id}`, { replace: true })}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
