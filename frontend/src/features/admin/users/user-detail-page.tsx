import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Info, KeyRound, Power, PowerOff, Save } from 'lucide-react';
import { departmentSchema, fullNameSchema, type UserDetail } from '@campushub/shared';
import { isApiError } from '@/lib/api-client';
import { formatDate, formatTimeRange, formatTimestamp } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox, Skeleton } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { SectionCard, ViewAllLink } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill, RoleBadge, StatusBadge } from '@/components/common/badges';
import { UserAvatar } from '@/components/common/small';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useUser, useUserMutations } from '../api';

function RoleForm({ u }: { u: UserDetail }) {
  const m = useUserMutations();
  const schema = z.object({ fullName: fullNameSchema, role: z.enum(['student', 'faculty_staff']), department: z.union([departmentSchema, z.literal('')]) });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    values: { fullName: u.fullName, role: u.role === 'faculty_staff' ? 'faculty_staff' : 'student', department: u.department ?? '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await m.update.mutateAsync({ id: u.id, body: { fullName: v.fullName, role: v.role, department: v.department || null } });
      toast.success('User updated.');
    } catch (e) {
      toast.error(isApiError(e) ? e.message : 'Something went wrong. Please try again.');
    }
  });
  return (
    <SectionCard title="Role & details">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Full name" error={form.formState.errors.fullName?.message}>
          {(p) => <Input {...p} {...form.register('fullName')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role">
            {(p) => (
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select
                    id={p.id}
                    value={field.value}
                    onValueChange={field.onChange}
                    options={[
                      { value: 'student', label: 'Student' },
                      { value: 'faculty_staff', label: 'Faculty / Staff' },
                    ]}
                  />
                )}
              />
            )}
          </Field>
          <Field label="Department" optional error={form.formState.errors.department?.message}>
            {(p) => <Input {...p} {...form.register('department')} />}
          </Field>
        </div>
        <div>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
            <Save /> Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export default function UserDetailPage() {
  const { userId } = useParams();
  const q = useUser(userId);
  const m = useUserMutations();
  const { data: settings } = usePublicSettings();
  const [dialog, setDialog] = React.useState<'deactivate' | 'activate' | 'reset' | null>(null);
  const [cancelAll, setCancelAll] = React.useState(false);
  useDocumentTitle(q.data?.fullName ?? 'User');
  useAdminBreadcrumb(q.data ? [{ label: 'Users', to: '/admin/users' }, { label: q.data.fullName }] : null);

  if (q.isLoading) return <Skeleton className="h-[520px] rounded-[14px]" />;
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <div className="card">
        <EmptyState title="User not found" message="This account may have been removed." action={<Button asChild><Link to="/admin/users">Users</Link></Button>} />
      </div>
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }
  const u = q.data!;
  const tz = settings?.campusTimezone ?? 'UTC';
  const protectedAccount = !u.permissions.canEdit;
  const c = u.bookingCounts;

  return (
    <div className="grid gap-5">
      <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <UserAvatar name={u.fullName} role={u.role} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[20px] font-semibold text-ink">{u.fullName}</h1>
            <RoleBadge role={u.role} />
            {!u.isActive && <Pill>Inactive</Pill>}
            {u.mustChangePassword && <Pill tone="warning">Must change password</Pill>}
          </div>
          <p className="truncate text-sm text-muted">{u.email}</p>
          <p className="tabular mt-1 text-[12.5px] text-muted">
            Joined {formatDate(u.createdAt.slice(0, 10))} · Last sign-in {u.lastSignInAt ? formatTimestamp(u.lastSignInAt, tz) : 'never'}
          </p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="grid content-start gap-5 lg:col-span-7">
          {protectedAccount ? (
            <SectionCard title="Role & details">
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                {u.role === 'super_admin' ? 'Super Admin accounts are managed through the provisioning procedure.' : "You can't change your own account here."}
              </p>
            </SectionCard>
          ) : (
            <RoleForm u={u} />
          )}
          <SectionCard title="Account actions">
            {protectedAccount ? (
              <p className="text-[13px] text-muted">{u.role === 'super_admin' ? 'Super Admin accounts are managed through the provisioning procedure.' : "You can't change your own account here."}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!u.permissions.canSendPasswordReset} onClick={() => setDialog('reset')}>
                  <KeyRound /> Send password reset email
                </Button>
                {u.isActive ? (
                  <Button variant="destructive-outline" onClick={() => setDialog('deactivate')}>
                    <PowerOff /> Deactivate account
                  </Button>
                ) : (
                  <Button onClick={() => setDialog('activate')}>
                    <Power /> Activate account
                  </Button>
                )}
              </div>
            )}
          </SectionCard>
        </div>
        <div className="lg:col-span-5">
          <SectionCard title="Bookings" action={<ViewAllLink to={`/admin/bookings?requesterId=${u.id}`} />}>
            <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[
                ['Total', c.total],
                ['Upcoming', c.upcoming],
                ['Pending', c.pending],
                ['Approved', c.approved],
                ['Rejected', c.rejected],
                ['Cancelled', c.cancelled + c.expired],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[10px] bg-surface-muted px-2 py-2.5">
                  <dd className="tabular font-display text-[18px] font-semibold text-ink">{v}</dd>
                  <dt className="text-[11.5px] text-muted">{k}</dt>
                </div>
              ))}
            </dl>
            {u.recentBookings.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted">No bookings yet.</p>
            ) : (
              <ul className="-mx-2">
                {u.recentBookings.map((b) => (
                  <li key={b.id}>
                    <Link to={`/admin/bookings/${b.id}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-surface-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{b.venue.name}</span>
                        <span className="tabular block text-[12px] text-muted">
                          <span className="font-mono">{b.reference}</span> · {formatDate(b.date)} · {formatTimeRange(b.startTime, b.endTime)}
                        </span>
                      </span>
                      <StatusBadge status={b.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'deactivate'}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
          setCancelAll(false);
        }}
        destructive
        title="Deactivate account?"
        description={`${u.fullName} will be signed out and unable to log in until reactivated.`}
        confirmLabel="Deactivate account"
        onConfirm={async () => {
          const r = await m.deactivate.mutateAsync({ id: u.id, cancelUpcomingBookings: cancelAll });
          toast.success(r.affected.cancelled ? `Account deactivated. ${r.affected.cancelled} bookings were cancelled.` : 'Account deactivated.');
        }}
      >
        {c.upcoming + c.pending > 0 && (
          <label className="flex items-start gap-2.5 rounded-[12px] border border-border p-3.5 text-[13px] text-ink">
            <Checkbox checked={cancelAll} onCheckedChange={(v) => setCancelAll(!!v)} className="mt-0.5" />
            Also cancel their {c.upcoming} upcoming bookings and pending requests
          </label>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'activate'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Activate account?"
        description={`${u.fullName} will be able to sign in again immediately.`}
        confirmLabel="Activate account"
        onConfirm={async () => {
          await m.activate.mutateAsync(u.id);
          toast.success('Account activated.');
        }}
      />
      <ConfirmDialog
        open={dialog === 'reset'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Send password reset email?"
        description={`A reset link will be emailed to ${u.email}.`}
        confirmLabel="Send email"
        onConfirm={async () => {
          await m.passwordReset.mutateAsync(u.id);
          toast.success('Password reset email sent.');
        }}
      />
    </div>
  );
}
