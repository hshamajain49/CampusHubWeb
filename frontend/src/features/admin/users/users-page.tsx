import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Search, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate, timeAgo } from '@/lib/format';
import { useDebouncedValue, useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill, RoleBadge } from '@/components/common/badges';
import { Pagination, UserAvatar } from '@/components/common/small';
import { useUsers } from '../api';
import { patchParams } from '@/lib/search-params';

export default function UsersPage() {
  useDocumentTitle('Users');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mdUp = useIsMdUp();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const role = params.get('role') ?? 'all';
  const status = params.get('status') ?? 'all';
  const page = Number(params.get('page') || 1);
  const list = useUsers({
    q: dq || undefined,
    role: role === 'all' ? undefined : role,
    serviceDepartmentId: params.get('serviceDepartmentId') || undefined,
    isActive: status === 'all' ? undefined : status === 'active',
    page,
    pageSize: 20,
  });
  const set = (patch: Record<string, string | null>) => {
    setParams(patchParams(params, patch), { replace: true });
  };
  const rows = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        description={list.data ? `${list.data.meta.total} accounts` : undefined}
        actions={
          <Button asChild>
            <Link to="/admin/users/new">
              <UserPlus /> Add user
            </Link>
          </Button>
        }
      />
      <div className="mb-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search users" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select
          aria-label="Role"
          value={role}
          onValueChange={(v) => set({ role: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All roles' },
            { value: 'student', label: 'Student' },
            { value: 'faculty_staff', label: 'Faculty / Staff' },
            { value: 'department_staff', label: 'Department Staff' },
            { value: 'super_admin', label: 'Super Admin' },
          ]}
        />
        <Select
          aria-label="Status"
          value={status}
          onValueChange={(v) => set({ status: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </div>
      {list.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={Users} title="No users match these filters." />
        </div>
      ) : mdUp ? (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Department</TH>
                <TH>Status</TH>
                <TH>Bookings</TH>
                <TH>Joined</TH>
                <TH>Last sign-in</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((u) => (
                <TR key={u.id} onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <TD>
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar name={u.fullName} role={u.role} size={32} className={cn(!u.isActive && 'opacity-50 grayscale')} />
                      <div className="min-w-0">
                        <Link to={`/admin/users/${u.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-ink hover:underline">
                          {u.fullName}
                        </Link>
                        <p className="max-w-[240px] truncate text-[12.5px] text-muted">{u.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <RoleBadge role={u.role} />
                  </TD>
                  <TD className="max-w-[160px] truncate text-muted" title={u.serviceDepartment?.name ?? u.department ?? undefined}>
                    {u.serviceDepartment?.name ?? u.department ?? '—'}
                  </TD>
                  <TD>{u.isActive ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}</TD>
                  <TD className="tabular whitespace-nowrap text-[13px] text-muted">
                    {u.bookingCounts.total} · {u.bookingCounts.upcoming} upcoming
                  </TD>
                  <TD className="tabular whitespace-nowrap text-[13px] text-muted">{formatDate(u.createdAt.slice(0, 10))}</TD>
                  <TD className="whitespace-nowrap text-[13px] text-muted">{u.lastSignInAt ? timeAgo(u.lastSignInAt) : 'Never'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      ) : (
        <div className="stagger grid gap-3">
          {rows.map((u) => (
            <div key={u.id} className="card press relative flex items-center gap-3 p-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <UserAvatar name={u.fullName} role={u.role} size={40} className={cn(!u.isActive && 'opacity-50 grayscale')} />
              <div className="min-w-0 flex-1">
                <Link to={`/admin/users/${u.id}`} className="block truncate font-semibold text-ink outline-none after:absolute after:inset-0 after:content-['']">
                  {u.fullName}
                </Link>
                <p className="truncate text-[12.5px] text-muted">{u.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <RoleBadge role={u.role} />
                  {!u.isActive && <Pill>Inactive</Pill>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.data && rows.length > 0 && <Pagination page={page} pageSize={20} total={list.data.meta.total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />}
    </div>
  );
}
