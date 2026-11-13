import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Building2, Construction, Eye, MoreHorizontal, Pencil, Plus, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import { VENUE_TYPES, VENUE_TYPE_LABELS, type AdminVenue } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { useDebouncedValue, useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/menus';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill } from '@/components/common/badges';
import { Pagination } from '@/components/common/small';
import { VenueBanner } from '@/components/common/venue-visuals';
import { useAdminVenues } from '../api';
import { VenueDialogs, type VenueDialog } from './venue-dialogs';
import { formatNumber } from '@/lib/format';
import { BlockDialog } from '../blocks/block-dialog';
import { patchParams } from '@/lib/search-params';

function VenueMenu({ v, onDialog, onBlock }: { v: AdminVenue; onDialog: (d: VenueDialog) => void; onBlock: () => void }) {
  const navigate = useNavigate();
  const canDelete = v.stats.totalBookings === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${v.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => navigate(`/admin/venues/${v.id}`)}>
          <Eye /> View
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/admin/venues/${v.id}/edit`)}>
          <Pencil /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onBlock}>
          <Construction /> Block time
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {v.isActive ? (
          <DropdownMenuItem destructive onSelect={() => onDialog('deactivate')}>
            <PowerOff /> Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onDialog('activate')}>
            <Power /> Activate
          </DropdownMenuItem>
        )}
        <Tooltip content={canDelete ? null : "Venues with booking history can't be deleted. Deactivate it instead."} side="left">
          <div>
            <DropdownMenuItem destructive disabled={!canDelete} onSelect={() => onDialog('delete')}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </div>
        </Tooltip>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function VenuesPage() {
  useDocumentTitle('Venues');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mdUp = useIsMdUp();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const [dialog, setDialog] = React.useState<{ v: AdminVenue; d: VenueDialog } | null>(null);
  const [blockFor, setBlockFor] = React.useState<AdminVenue | null>(null);
  const status = params.get('status') ?? 'all';
  const page = Number(params.get('page') || 1);
  const list = useAdminVenues({
    q: dq || undefined,
    type: params.get('type') || undefined,
    isActive: status === 'all' ? undefined : status === 'active',
    sort: 'name:asc',
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
        title="Venues"
        description={list.data ? `${list.data.meta.total} venues` : undefined}
        actions={
          <Button asChild>
            <Link to="/admin/venues/new">
              <Plus /> Add venue
            </Link>
          </Button>
        }
      />
      <div className="mb-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search venues" placeholder="Search by name or building" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select
          aria-label="Type"
          value={params.get('type') || 'all'}
          onValueChange={(v) => set({ type: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All types' }, ...VENUE_TYPES.map((t) => ({ value: t, label: VENUE_TYPE_LABELS[t] }))]}
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
        <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Building2}
            title={dq || status !== 'all' || params.get('type') ? 'No venues match these filters.' : 'No venues yet'}
            message={dq || status !== 'all' ? undefined : 'Add your first bookable space.'}
            action={
              <Button asChild>
                <Link to="/admin/venues/new">
                  <Plus /> Add venue
                </Link>
              </Button>
            }
          />
        </div>
      ) : mdUp ? (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>Venue</TH>
                <TH>Type</TH>
                <TH>Capacity</TH>
                <TH>Upcoming</TH>
                <TH>Status</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((v) => (
                <TR key={v.id} onClick={() => navigate(`/admin/venues/${v.id}`)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <VenueBanner venueId={v.id} imageUrl={v.imageThumbUrl} className={cn('size-10 shrink-0 rounded-[10px]', !v.isActive && 'opacity-50 grayscale')} icon={false} />
                      <div className="min-w-0">
                        <Link to={`/admin/venues/${v.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-ink hover:underline">
                          {v.name}
                        </Link>
                        <p className="truncate text-[12.5px] text-muted">{v.building}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-muted">{VENUE_TYPE_LABELS[v.venueType]}</TD>
                  <TD className="tabular">{formatNumber(v.capacity)} seats</TD>
                  <TD className="tabular whitespace-nowrap text-[13px] text-muted">
                    {v.stats.upcomingApprovedCount} approved · {v.stats.pendingCount} pending
                  </TD>
                  <TD>{v.isActive ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}</TD>
                  <TD>
                    <VenueMenu v={v} onDialog={(d) => setDialog({ v, d })} onBlock={() => setBlockFor(v)} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      ) : (
        <div className="stagger grid gap-3">
          {rows.map((v) => (
            <div key={v.id} className="card press relative flex items-center gap-3 p-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <VenueBanner venueId={v.id} imageUrl={v.imageThumbUrl} className={cn('size-12 shrink-0 rounded-[12px]', !v.isActive && 'opacity-50 grayscale')} icon={false} />
              <div className="min-w-0 flex-1">
                <Link to={`/admin/venues/${v.id}`} className="block truncate font-semibold text-ink outline-none after:absolute after:inset-0 after:content-['']">
                  {v.name}
                </Link>
                <p className="tabular truncate text-[12.5px] text-muted">
                  {v.building} · {formatNumber(v.capacity)} seats
                </p>
                <div className="mt-1">{v.isActive ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}</div>
              </div>
              <div className="relative z-10">
                <VenueMenu v={v} onDialog={(d) => setDialog({ v, d })} onBlock={() => setBlockFor(v)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {list.data && rows.length > 0 && <Pagination page={page} pageSize={20} total={list.data.meta.total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />}
      {dialog && <VenueDialogs venue={dialog.v} dialog={dialog.d} onClose={() => setDialog(null)} />}
      <BlockDialog open={!!blockFor} onOpenChange={(o) => !o && setBlockFor(null)} initial={{ venueId: blockFor?.id }} lockVenue />
    </div>
  );
}
