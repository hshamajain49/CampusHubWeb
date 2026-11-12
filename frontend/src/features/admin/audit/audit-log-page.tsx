import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, ScrollText, X } from 'lucide-react';
import { AUDIT_ACTION_LABELS, type AuditLogEntry } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination } from '@/components/common/small';
import { DatePicker } from '@/components/common/pickers';
import { useAuditLogs, useUsers } from '../api';
import { patchParams } from '@/lib/search-params';

const ENTITY = [
  { value: 'all', label: 'All entities' },
  { value: 'booking', label: 'Booking' },
  { value: 'venue', label: 'Venue' },
  { value: 'venue_block', label: 'Venue block' },
  { value: 'user', label: 'User' },
  { value: 'settings', label: 'Settings' },
  { value: 'system', label: 'System' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'service_department', label: 'Service department' },
  { value: 'complaint_category', label: 'Complaint category' },
];
const ACTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'booking.', label: 'Booking decisions' },
  { value: 'venue.', label: 'Venue changes' },
  { value: 'venue_block.', label: 'Venue blocks' },
  { value: 'user.', label: 'User changes' },
  { value: 'settings.', label: 'Settings' },
  { value: 'complaint.', label: 'Complaint actions' },
  { value: 'service_department.', label: 'Departments' },
  { value: 'complaint_category.', label: 'Complaint categories' },
];

function entityLink(e: AuditLogEntry): string | null {
  if (!e.entityId) return null;
  if (e.entityType === 'booking') return `/admin/bookings/${e.entityId}`;
  if (e.entityType === 'venue') return e.action === 'venue.deleted' ? null : `/admin/venues/${e.entityId}`;
  if (e.entityType === 'user') return `/admin/users/${e.entityId}`;
  if (e.entityType === 'settings') return '/admin/settings';
  if (e.entityType === 'complaint') return `/admin/complaints/${e.entityId}`;
  if (e.entityType === 'service_department') return '/admin/complaint-setup?tab=departments';
  if (e.entityType === 'complaint_category') return '/admin/complaint-setup?tab=categories';
  return null;
}

export default function AuditLogPage() {
  useDocumentTitle('Audit log');
  const [params, setParams] = useSearchParams();
  const { data: settings } = usePublicSettings();
  const admins = useUsers({ role: 'super_admin', pageSize: 100 });
  const [open, setOpen] = React.useState<number | null>(null);
  const get = (k: string) => params.get(k) ?? '';
  const page = Number(get('page') || 1);
  const q = useAuditLogs({
    entityType: get('entityType') || undefined,
    entityId: get('entityId') || undefined,
    action: get('action') || undefined,
    actorId: get('actorId') || undefined,
    from: get('from') || undefined,
    to: get('to') || undefined,
    page,
    pageSize: 50,
  });
  const set = (patch: Record<string, string | null>) => {
    setParams(patchParams(params, patch), { replace: true });
  };
  const tz = settings?.campusTimezone ?? 'UTC';
  const any = ['entityType', 'entityId', 'action', 'actorId', 'from', 'to'].some((k) => get(k));

  return (
    <div>
      <PageHeader title="Audit log" description="Every admin and security-relevant action, with before and after values." />
      <div className="card mb-5 flex flex-wrap items-center gap-2 p-3">
        <div className="w-[160px]">
          <DatePicker value={get('from') || null} onChange={(v) => set({ from: v })} placeholder="From" max={get('to') || undefined} />
        </div>
        <div className="w-[160px]">
          <DatePicker value={get('to') || null} onChange={(v) => set({ to: v })} placeholder="To" min={get('from') || undefined} />
        </div>
        <div className="w-[170px]">
          <Select aria-label="Entity type" value={get('entityType') || 'all'} onValueChange={(v) => set({ entityType: v === 'all' ? null : v })} options={ENTITY} />
        </div>
        <div className="w-[190px]">
          <Select aria-label="Action" value={get('action') || 'all'} onValueChange={(v) => set({ action: v === 'all' ? null : v })} options={ACTIONS} />
        </div>
        <div className="w-[200px]">
          <Select
            aria-label="Actor"
            value={get('actorId') || 'all'}
            onValueChange={(v) => set({ actorId: v === 'all' ? null : v })}
            options={[{ value: 'all', label: 'All admins' }, ...(admins.data?.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))]}
          />
        </div>
        {any && (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            <X /> Clear
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : q.isError ? (
        <div className="card">
          <ErrorState onRetry={() => q.refetch()} />
        </div>
      ) : !q.data!.data.length ? (
        <div className="card">
          <EmptyState icon={ScrollText} title="No audit entries match." />
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH className="w-8">
                  <span className="sr-only">Expand</span>
                </TH>
                <TH>Time</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Summary</TH>
              </tr>
            </THead>
            <tbody>
              {q.data!.data.map((e) => {
                const isOpen = open === e.id;
                const link = entityLink(e);
                return (
                  <React.Fragment key={e.id}>
                    <TR onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                      <TD>
                        <ChevronRight className={cn('size-4 text-muted transition-transform duration-150 ease-out', isOpen && 'rotate-90')} aria-hidden />
                      </TD>
                      <TD className="tabular whitespace-nowrap text-[13px]">{formatTimestamp(e.createdAt, tz)}</TD>
                      <TD className="whitespace-nowrap">{e.actor?.fullName ?? <span className="text-muted">System</span>}</TD>
                      <TD className="whitespace-nowrap font-semibold text-ink">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</TD>
                      <TD className="whitespace-nowrap">
                        {link ? (
                          <Link to={link} onClick={(ev) => ev.stopPropagation()} className="font-medium text-primary hover:underline">
                            {e.entityType.replace('_', ' ')}
                          </Link>
                        ) : (
                          <span className="text-muted">{e.entityType.replace('_', ' ')}</span>
                        )}
                      </TD>
                      <TD className="max-w-[360px]">
                        <span className="block truncate">{e.summary}</span>
                      </TD>
                    </TR>
                    {isOpen && (
                      <tr className="border-t border-border bg-surface-muted/60">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="grid gap-2 text-[12.5px] text-muted sm:grid-cols-3">
                            <p>
                              <span className="font-semibold text-ink">Action:</span> <code className="font-mono">{e.action}</code>
                            </p>
                            <p>
                              <span className="font-semibold text-ink">Entity ID:</span> <code className="font-mono">{e.entityId ?? '—'}</code>
                            </p>
                            <p>
                              <span className="font-semibold text-ink">IP:</span> <code className="font-mono">{e.ipAddress ?? '—'}</code>
                            </p>
                          </div>
                          <pre className="mt-3 max-h-80 overflow-auto rounded-[10px] border border-border bg-surface p-3 font-mono text-[12px] leading-5 text-ink">
                            {JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableShell>
      )}
      {q.data && q.data.data.length > 0 && <Pagination page={page} pageSize={50} total={q.data.meta.total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />}
    </div>
  );
}
