// A14 Reports. Chart palette validated with the dataviz validator (light surface):
// slot 1 #2F5FD3, slot 2 #14A39A — all six checks pass. Single-series charts use slot 1 only.
// Part-to-whole uses tall segmented bars (≤ 6 parts) instead of donuts; every chart has a table twin.
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { ROLE_LABELS, STATUS_LABELS, addDays } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/download';
import { formatDate, formatPercent, formatShortDay, formatTimestamp } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { ComplaintReports } from './complaint-reports';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { ErrorState } from '@/components/common/states';
import { Pill } from '@/components/common/badges';
import { DatePicker } from '@/components/common/pickers';
import { useAllVenueOptions, useReports } from '../api';
import { patchParams } from '@/lib/search-params';
import { AXIS, ChartCard, GRID, Kpi, SegmentedBar, SLOT1, SLOT2, STATUS_FILL, TooltipBox } from './report-bits';

type SortKey = 'venueName' | 'requests' | 'approved' | 'approvedHours' | 'utilizationPct';

function BookingReports() {
  const [params, setParams] = useSearchParams();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const venues = useAllVenueOptions();
  const today = now?.date ?? '';
  const preset = params.get('range') ?? '30';
  const monthStart = today ? `${today.slice(0, 8)}01` : '';
  const ranges: Record<string, { from: string; to: string }> = {
    '7': { from: today && addDays(today, -6), to: today },
    '30': { from: today && addDays(today, -29), to: today },
    '90': { from: today && addDays(today, -89), to: today },
    month: { from: monthStart, to: today },
    custom: { from: params.get('from') || (today && addDays(today, -29)), to: params.get('to') || today },
  };
  const { from, to } = ranges[preset] ?? ranges['30']!;
  const venueId = params.get('venueId') || undefined;
  const report = useReports({ from, to, venueId });
  const r = report.data;
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'requests', dir: 'desc' });

  const set = (patch: Record<string, string | null>) => {
    setParams(patchParams(params, patch, false), { replace: true });
  };

  const rows = React.useMemo(() => {
    const list = [...(r?.byVenue ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const c = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sort.dir === 'asc' ? c : -c;
    });
    return list;
  }, [r, sort]);
  const th = (key: SortKey, label: string) => (
    <TH sort={sort.key === key ? sort.dir : false} onSort={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {label}
    </TH>
  );

  const empty = !r || r.totals.requests === 0;
  const topVenues = (r?.byVenue ?? []).filter((v) => v.requests > 0).slice(0, 10);
  const utilisation = [...(r?.byVenue ?? [])].sort((a, b) => b.utilizationPct - a.utilizationPct).slice(0, 10);
  const venueHeight = (n: number) => Math.max(160, n * 30 + 40);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{r ? `${formatDate(r.range.from)} – ${formatDate(r.range.to)}` : ''}</p>
        <div className="flex flex-wrap items-center gap-2">
          {r && <Pill tone="neutral">Generated {formatTimestamp(r.generatedAt, settings?.campusTimezone ?? 'UTC')}</Pill>}
          <Button variant="outline" onClick={() => void downloadFile('/admin/bookings/export.csv', `bookings-${today}.csv`, { dateFrom: from, dateTo: to, venueId }).catch(() => undefined)}>
            <Download /> Export bookings (CSV)
          </Button>
        </div>
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="w-full sm:w-[190px]">
          <Select
            aria-label="Date range"
            value={preset}
            onValueChange={(v) => set({ range: v === '30' ? null : v, ...(v !== 'custom' ? { from: null, to: null } : {}) })}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: 'month', label: 'This month' },
              { value: 'custom', label: 'Custom (e.g. this term)' },
            ]}
          />
        </div>
        {preset === 'custom' && (
          <>
            <div className="w-[168px]">
              <DatePicker value={from || null} onChange={(v) => set({ from: v })} max={to || undefined} />
            </div>
            <div className="w-[168px]">
              <DatePicker value={to || null} onChange={(v) => set({ to: v })} min={from || undefined} />
            </div>
          </>
        )}
        <div className="w-full sm:w-[220px]">
          <Select
            aria-label="Venue"
            value={venueId ?? 'all'}
            onValueChange={(v) => set({ venueId: v === 'all' ? null : v })}
            options={[{ value: 'all', label: 'All venues' }, ...(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
          />
        </div>
      </div>

      {report.isError && !r ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : !r ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}</div>
      ) : (
        // Hold the previous render at reduced opacity while refetching (no skeleton flash).
        <div className={cn('grid gap-5 transition-opacity duration-150', report.isPlaceholderData && 'opacity-60')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Requests" value={String(r.totals.requests)} />
            <Kpi label="Approved" value={String(r.totals.approved)} />
            <Kpi label="Rejected" value={String(r.totals.rejected)} />
            <Kpi label="Cancelled" value={String(r.totals.cancelled)} />
            <Kpi label="Expired" value={String(r.totals.expired)} />
            <Kpi label="Approval rate" value={formatPercent(r.approvalRate)} hint="Approved ÷ (approved + rejected)" />
            <Kpi label="Avg. decision time" value={`${r.avgDecisionHours} h`} />
            <Kpi label="Approved hours" value={`${r.approvedHours} h`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Requests over time"
              empty={empty}
              table={
                <table>
                  <caption>Requests over time</caption>
                  <thead><tr><th>Date</th><th>Submitted</th><th>Approved</th></tr></thead>
                  <tbody>{r.trend.map((t) => <tr key={t.date}><td>{t.date}</td><td>{t.submitted}</td><td>{t.approved}</td></tr>)}</tbody>
                </table>
              }
            >
              <ul className="mb-2 flex gap-4 text-[12.5px] text-muted">
                <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SLOT1 }} />Submitted</li>
                <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SLOT2 }} />Approved</li>
              </ul>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={r.trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(d) => formatShortDay(d).slice(4)} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<TooltipBox fmt={(d) => formatShortDay(d)} />} cursor={{ stroke: '#C5CDDC', strokeWidth: 1 }} />
                  <Line type="monotone" dataKey="submitted" name="Submitted" stroke={SLOT1} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="approved" name="Approved" stroke={SLOT2} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <section className="card grid content-start gap-6 p-4 md:p-5">
              <div>
                <h2 className="eyebrow mb-3">By status</h2>
                <SegmentedBar
                  label="Bookings by status"
                  parts={(['approved', 'pending', 'rejected', 'cancelled', 'expired'] as const).map((s) => ({ key: s, name: STATUS_LABELS[s], value: r.totals[s], color: STATUS_FILL[s]! }))}
                />
              </div>
              <div>
                <h2 className="eyebrow mb-3">By requester role</h2>
                <SegmentedBar
                  label="Requests by requester role"
                  parts={r.byRole.map((x, i) => ({ key: x.role, name: ROLE_LABELS[x.role], value: x.requests, color: i === 0 ? SLOT1 : SLOT2 }))}
                />
                <p className="tabular mt-2 text-[12.5px] text-muted">
                  Approved: {r.byRole.map((x) => `${ROLE_LABELS[x.role]} ${x.approved}`).join(' · ')}
                </p>
              </div>
            </section>

            <ChartCard
              title="By venue (requests, top 10)"
              empty={!topVenues.length}
              table={
                <table>
                  <caption>Requests by venue</caption>
                  <thead><tr><th>Venue</th><th>Requests</th></tr></thead>
                  <tbody>{topVenues.map((v) => <tr key={v.venueId}><td>{v.venueName}</td><td>{v.requests}</td></tr>)}</tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={venueHeight(topVenues.length)}>
                <BarChart data={topVenues} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="venueName" width={130} tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<TooltipBox />} cursor={{ fill: 'rgba(47,95,211,0.06)' }} />
                  <Bar dataKey="requests" name="Requests" fill={SLOT1} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Utilisation by venue (% of operating hours)"
              empty={empty}
              table={
                <table>
                  <caption>Utilisation by venue</caption>
                  <thead><tr><th>Venue</th><th>Utilisation %</th></tr></thead>
                  <tbody>{utilisation.map((v) => <tr key={v.venueId}><td>{v.venueName}</td><td>{v.utilizationPct}</td></tr>)}</tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={venueHeight(utilisation.length)}>
                <BarChart data={utilisation} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" unit="%" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="venueName" width={130} tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<TooltipBox />} cursor={{ fill: 'rgba(47,95,211,0.06)' }} />
                  <Bar dataKey="utilizationPct" name="Utilisation %" fill={SLOT1} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="By weekday (approved)"
              empty={empty}
              table={
                <table>
                  <caption>Approved bookings by weekday</caption>
                  <thead><tr><th>Weekday</th><th>Approved</th></tr></thead>
                  <tbody>{r.byWeekday.map((w) => <tr key={w.weekday}><td>{w.label}</td><td>{w.approved}</td></tr>)}</tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={r.byWeekday} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<TooltipBox />} cursor={{ fill: 'rgba(47,95,211,0.06)' }} />
                  <Bar dataKey="approved" name="Approved" fill={SLOT1} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Busiest start hours (approved)"
              empty={empty}
              table={
                <table>
                  <caption>Approved bookings by start hour</caption>
                  <thead><tr><th>Hour</th><th>Approved</th></tr></thead>
                  <tbody>{r.byHour.map((h) => <tr key={h.hour}><td>{h.hour}:00</td><td>{h.approved}</td></tr>)}</tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={r.byHour} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(h) => String(h).padStart(2, '0')} />
                  <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<TooltipBox fmt={(h) => `${String(h).padStart(2, '0')}:00`} />} cursor={{ fill: 'rgba(47,95,211,0.06)' }} />
                  <Bar dataKey="approved" name="Approved" fill={SLOT1} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <section>
            <h2 className="eyebrow mb-2.5">Venue utilisation</h2>
            <TableShell>
              <Table>
                <THead>
                  <tr>
                    {th('venueName', 'Venue')}
                    {th('requests', 'Requests')}
                    {th('approved', 'Approved')}
                    {th('approvedHours', 'Approved hours')}
                    {th('utilizationPct', 'Utilisation %')}
                  </tr>
                </THead>
                <tbody>
                  {rows.map((v) => (
                    <TR key={v.venueId}>
                      <TD className="font-semibold text-ink">{v.venueName}</TD>
                      <TD className="tabular">{v.requests}</TD>
                      <TD className="tabular">{v.approved}</TD>
                      <TD className="tabular">{v.approvedHours}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span className="tabular w-12 text-right">{v.utilizationPct}%</span>
                          <span className="h-2 w-24 overflow-hidden rounded-full bg-[#E3E9F8]" aria-hidden>
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, v.utilizationPct)}%`, background: SLOT1 }} />
                          </span>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          </section>
        </div>
      )}
    </div>
  );
}


/** A14 + CA05: one Reports page with Bookings and Complaints tabs (?tab=complaints). Each tab keeps its own filters. */
export default function ReportsPage() {
  useDocumentTitle('Reports');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'complaints' ? 'complaints' : 'bookings';
  return (
    <div className="grid gap-5">
      <PageHeader className="mb-0" title="Reports" />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'bookings' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
        </TabsList>
        <TabsContent value="bookings" className="mt-5 outline-none">
          {tab === 'bookings' && <BookingReports />}
        </TabsContent>
        <TabsContent value="complaints" className="mt-5 outline-none">
          {tab === 'complaints' && <ComplaintReports />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
