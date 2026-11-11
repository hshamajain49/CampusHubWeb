import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CalendarClock, Construction, MapPin, MoreHorizontal, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { BLOCK_TYPE_LABELS, VENUE_TYPE_LABELS, type AdminBookingListItem, type VenueBlock } from '@campushub/shared';
import { isApiError } from '@/lib/api-client';
import { formatDate, formatShortDay, formatTimeRange, formatNumber } from '@/lib/format';
import { useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menus';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { SectionCard, StatCard } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill, StatusBadge } from '@/components/common/badges';
import { AmenityChip, VenueBanner } from '@/components/common/venue-visuals';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/small';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useAdminBookings, useAdminVenue, useBlockMutations, useBlocks } from '../api';
import { VenueDialogs, type VenueDialog } from './venue-dialogs';
import { BlockDialog } from '../blocks/block-dialog';
import { BookingsTable } from '../bookings/bookings-page';
import { DecisionDialog, type DecisionMode } from '../bookings/decision-dialogs';
import { AdminCalendar } from '../calendar/admin-calendar-page';

function BlocksTab({ venueId, onAdd, onEdit }: { venueId: string; onAdd: () => void; onEdit: (b: VenueBlock) => void }) {
  const [includePast, setIncludePast] = React.useState(false);
  const blocks = useBlocks({ venueId, includePast, pageSize: 100 });
  const m = useBlockMutations();
  const [del, setDel] = React.useState<VenueBlock | null>(null);
  const mdUp = useIsMdUp();
  const rows = blocks.data?.data ?? [];
  const when = (b: VenueBlock) => `${formatShortDay(b.start.slice(0, 10))} ${b.start.slice(11, 16)}`;
  const until = (b: VenueBlock) => `${formatShortDay(b.end.slice(0, 10))} ${b.end.slice(11, 16)}`;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-[13px] font-semibold text-ink">
          <Switch checked={includePast} onCheckedChange={setIncludePast} /> Show past blocks
        </label>
        <Button onClick={onAdd}>
          <Plus /> Add block
        </Button>
      </div>
      {blocks.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState compact icon={Construction} title="No blocks scheduled." message="Block this venue for maintenance or special events." />
        </div>
      ) : mdUp ? (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>Type</TH>
                <TH>Reason</TH>
                <TH>Start</TH>
                <TH>End</TH>
                <TH>Created by</TH>
                <TH className="w-24">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <span className="chip slot-blocked inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-[#334155]">{BLOCK_TYPE_LABELS[b.blockType]}</span>
                  </TD>
                  <TD className="max-w-[260px]">
                    <span className="block truncate">{b.reason}</span>
                  </TD>
                  <TD className="tabular whitespace-nowrap">{when(b)}</TD>
                  <TD className="tabular whitespace-nowrap">{until(b)}</TD>
                  <TD className="text-muted">{b.createdBy.fullName}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Edit block" onClick={() => onEdit(b)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Delete block" onClick={() => setDel(b)}>
                        <Trash2 className="size-4 text-destructive-text" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      ) : (
        <div className="grid gap-3">
          {rows.map((b) => (
            <div key={b.id} className="card flex items-start gap-3 p-4">
              <span className="slot-blocked grid size-10 shrink-0 place-items-center rounded-[10px]">
                <Construction className="size-4 text-[#334155]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{BLOCK_TYPE_LABELS[b.blockType]}</p>
                <p className="text-[13px] text-ink">{b.reason}</p>
                <p className="tabular text-[12px] text-muted">
                  {when(b)} → {until(b)}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Edit block" onClick={() => onEdit(b)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete block" onClick={() => setDel(b)}>
                <Trash2 className="size-4 text-destructive-text" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title="Remove this block?"
        description="The time becomes bookable again."
        confirmLabel="Remove block"
        onConfirm={async () => {
          await m.remove.mutateAsync(del!);
          toast.success('Block removed.');
        }}
      />
    </div>
  );
}

function BookingsTab({ venueId }: { venueId: string }) {
  const [sort, setSort] = React.useState('start:desc');
  const [page, setPage] = React.useState(1);
  const list = useAdminBookings({ venueId, sort, page, pageSize: 20 });
  const [decision, setDecision] = React.useState<{ b: AdminBookingListItem; mode: DecisionMode } | null>(null);
  if (list.isLoading) return <Skeleton className="h-60" />;
  if (list.isError) return <ErrorState compact onRetry={() => list.refetch()} />;
  if (!list.data!.data.length) return <div className="card"><EmptyState compact icon={CalendarClock} title="No bookings for this venue yet." /></div>;
  return (
    <>
      <BookingsTable rows={list.data!.data} sort={sort} onSort={setSort} hideVenue onDecide={(b, mode) => setDecision({ b, mode })} />
      <Pagination page={page} pageSize={20} total={list.data!.meta.total} onPage={setPage} />
      <DecisionDialog booking={decision?.b ?? null} mode={decision?.mode ?? null} onClose={() => setDecision(null)} />
    </>
  );
}

export default function VenueDetailAdminPage() {
  const { venueId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const q = useAdminVenue(venueId);
  const recent = useAdminBookings({ venueId, sort: 'createdAt:desc', pageSize: 5 });
  const [dialog, setDialog] = React.useState<VenueDialog>(null);
  const [blockDialog, setBlockDialog] = React.useState<{ block?: VenueBlock } | null>(null);
  useDocumentTitle(q.data?.name ?? 'Venue');
  useAdminBreadcrumb(q.data ? [{ label: 'Venues', to: '/admin/venues' }, { label: q.data.name }] : null);

  if (q.isLoading) return <Skeleton className="h-[540px] rounded-[14px]" />;
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <div className="card"><EmptyState title="Venue not found" action={<Button asChild><Link to="/admin/venues">Venues</Link></Button>} /></div>
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }
  const v = q.data!;
  const next = v.stats.nextBooking;

  return (
    <div className="grid gap-5">
      <section className="card overflow-hidden">
        <VenueBanner venueId={v.id} imageUrl={v.imageUrl} alt={v.name} rounded={false} className="h-28 md:h-36" />
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[22px] font-semibold leading-8 text-ink">{v.name}</h1>
              {v.isActive ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
              <span>{VENUE_TYPE_LABELS[v.venueType]}</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {v.building}
                {v.locationDetails ? ` · ${v.locationDetails}` : ''}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to={`/admin/venues/${v.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setBlockDialog({})}>
              <Construction /> Block time
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More venue actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {v.isActive ? (
                  <DropdownMenuItem destructive onSelect={() => setDialog('deactivate')}>
                    <PowerOff /> Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setDialog('activate')}>
                    <Power /> Activate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem destructive disabled={v.stats.totalBookings > 0} onSelect={() => setDialog('delete')}>
                  <Trash2 /> Delete{v.stats.totalBookings > 0 ? ' (has bookings)' : ''}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="blocks">Blocks</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 grid gap-5 outline-none">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={CalendarClock} tone="approved" label="Upcoming approved" value={v.stats.upcomingApprovedCount} />
            <StatCard icon={CalendarClock} tone="pending" label="Pending" value={v.stats.pendingCount} />
            <StatCard icon={CalendarClock} tone="neutral" label="Total bookings" value={v.stats.totalBookings} />
            <StatCard icon={CalendarClock} tone="teal" label="Next booking" value={next ? formatDate(next.date) : '—'} detail={next ? formatTimeRange(next.startTime, next.endTime) : 'Nothing scheduled'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="About this space">
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[12px] text-muted">Capacity</dt>
                  <dd className="tabular font-semibold text-ink">{formatNumber(v.capacity)} people</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Created by</dt>
                  <dd className="font-semibold text-ink">{v.createdBy?.fullName ?? '—'}</dd>
                </div>
              </dl>
              <p className="whitespace-pre-line text-sm leading-6 text-ink">{v.description}</p>
              {v.amenities.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {v.amenities.map((a) => (
                    <AmenityChip key={a} name={a} />
                  ))}
                </div>
              )}
            </SectionCard>
            <SectionCard title="Recent bookings" bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
              {recent.isLoading ? (
                <Skeleton className="m-2 h-32" />
              ) : !recent.data?.data.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted">No bookings yet.</p>
              ) : (
                <ul>
                  {recent.data.data.map((b) => (
                    <li key={b.id}>
                      <Link to={`/admin/bookings/${b.id}`} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-muted">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{b.requester.fullName}</span>
                          <span className="tabular block text-[12.5px] text-muted">
                            {formatDate(b.date)} · {formatTimeRange(b.startTime, b.endTime)}
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
        </TabsContent>
        <TabsContent value="blocks" className="mt-5 outline-none">
          <BlocksTab venueId={v.id} onAdd={() => setBlockDialog({})} onEdit={(b) => setBlockDialog({ block: b })} />
        </TabsContent>
        <TabsContent value="bookings" className="mt-5 outline-none">
          <BookingsTab venueId={v.id} />
        </TabsContent>
        <TabsContent value="calendar" className="mt-5 outline-none">
          <AdminCalendar lockedVenueId={v.id} />
        </TabsContent>
      </Tabs>

      <VenueDialogs venue={v} dialog={dialog} onClose={() => setDialog(null)} />
      <BlockDialog open={!!blockDialog} onOpenChange={(o) => !o && setBlockDialog(null)} block={blockDialog?.block} initial={{ venueId: v.id }} lockVenue />
    </div>
  );
}
