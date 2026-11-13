// CA05 Complaint reports (§17, data from C29). Dataviz notes: single-measure bar charts use slot 1 only (identity is on
// the axis labels, so per-category colours would just be a rainbow of one series); the trend pairs slot 1/slot 2;
// backlog age is a segmented bar in the validated green/amber/red status set with a legend. Every chart has a table twin.
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES, ROLE_LABELS, addDays } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/download';
import { formatDate, formatPercent, formatShortDay, formatTimestamp } from '@/lib/format';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorState } from '@/components/common/states';
import { Pill } from '@/components/common/badges';
import { DatePicker } from '@/components/common/pickers';
import { patchParams } from '@/lib/search-params';
import { useComplaintReport, useServiceDepartments } from '@/features/complaints/api';
import { AXIS, ChartCard, GRID, Kpi, SegmentedBar, SLOT1, SLOT2, STATUS_FILL, TooltipBox, useCategoryAxis } from './report-bits';

const EMPTY = 'No complaints in this period.';
const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} d`);
const barHeight = (n: number) => Math.max(140, n * 30 + 40);
/** Legend labels wear text ink; the swatch beside them carries the series colour. */
const legendText = (value: string) => <span style={{ color: '#5E6A82' }}>{value}</span>;

function HBar({ data, name, dataKey = 'count' }: { data: { label: string; count: number }[]; name: string; dataKey?: string }) {
  const axis = useCategoryAxis(150);
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={axis.width} tickFormatter={axis.tickFormatter} tick={AXIS} axisLine={false} tickLine={false} />
        <RTooltip cursor={{ fill: 'rgba(47,95,211,0.06)' }} content={<TooltipBox />} />
        <Bar dataKey={dataKey} name={name} fill={SLOT1} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TwinTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function ComplaintReports() {
  const [params, setParams] = useSearchParams();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const depts = useServiceDepartments();
  const today = now?.date ?? '';
  const preset = params.get('range') ?? '30';
  const ranges: Record<string, { from: string; to: string }> = {
    '7': { from: today && addDays(today, -6), to: today },
    '30': { from: today && addDays(today, -29), to: today },
    '90': { from: today && addDays(today, -89), to: today },
    month: { from: today ? `${today.slice(0, 8)}01` : '', to: today },
    custom: { from: params.get('from') || (today && addDays(today, -29)), to: params.get('to') || today },
  };
  const { from, to } = ranges[preset] ?? ranges['30']!;
  const departmentId = params.get('departmentId') || undefined;
  const report = useComplaintReport({ from: from || undefined, to: to || undefined, departmentId });
  const r = report.data;
  const set = (patch: Record<string, string | null>) => setParams(patchParams(params, patch, false), { replace: true });
  const deptAxis = useCategoryAxis(170);
  const empty = !r || r.totals.submitted === 0;
  const open = r ? r.totals.pending_review + r.totals.in_progress + r.totals.awaiting_confirmation : 0;

  return (
    <div className="grid gap-5">
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
              { value: 'custom', label: 'Custom' },
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
        <div className="w-full sm:w-[240px]">
          <Select
            aria-label="Department"
            value={departmentId ?? 'all'}
            onValueChange={(v) => set({ departmentId: v === 'all' ? null : v })}
            options={[{ value: 'all', label: 'All departments' }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {r && <Pill tone="neutral">Generated {formatTimestamp(r.generatedAt, settings?.campusTimezone ?? 'UTC')}</Pill>}
          <Button
            variant="outline"
            onClick={() => void downloadFile('/admin/complaints/export.csv', `complaints-${today}.csv`, { dateFrom: from, dateTo: to, departmentId }).catch(() => undefined)}
          >
            <Download /> Export complaints (CSV)
          </Button>
        </div>
      </div>

      {report.isError && !r ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : !r ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}</div>
      ) : (
        <div className={cn('grid gap-5 transition-opacity duration-150', report.isPlaceholderData && 'opacity-60')}>
          <p className="text-sm text-muted">
            {formatDate(r.range.from)} – {formatDate(r.range.to)} · complaints submitted in this period
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Submitted" value={String(r.totals.submitted)} />
            <Kpi label="Open now" value={String(open)} hint="Of those submitted in the period" />
            <Kpi label="Resolved" value={String(r.totals.resolved)} />
            <Kpi label="Resolution rate" value={formatPercent(r.resolutionRate)} hint="Resolved ÷ (submitted − withdrawn)" />
            <Kpi label="Avg. time to start" value={hours(r.avgHoursToStart)} />
            <Kpi label="Avg. time to resolve" value={hours(r.avgHoursToResolve)} />
            <Kpi label="Reopen rate" value={formatPercent(r.reopenRate)} hint="Rejected or reopened after work was done" />
            <Kpi label="Auto-resolved share" value={formatPercent(r.autoResolvedShare)} hint="Resolved without the reporter's approval" />
          </div>

          <ChartCard
            title="Submitted vs resolved"
            empty={empty}
            emptyText={EMPTY}
            table={<TwinTable caption="Submitted and resolved per day" head={['Date', 'Submitted', 'Resolved']} rows={r.trend.map((t) => [t.date, t.submitted, t.resolved])} />}
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={r.trend} margin={{ left: -16, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="date" tickFormatter={(d) => formatShortDay(d)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <RTooltip content={<TooltipBox fmt={(d) => formatShortDay(d)} />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} formatter={legendText} />
                <Line type="linear" dataKey="submitted" name="Submitted" stroke={SLOT1} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                <Line type="linear" dataKey="resolved" name="Resolved" stroke={SLOT2} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="By status"
              empty={empty}
              emptyText={EMPTY}
              table={<TwinTable caption="Complaints by status" head={['Status', 'Complaints']} rows={COMPLAINT_STATUSES.map((s) => [COMPLAINT_STATUS_LABELS[s], r.totals[s]])} />}
            >
              <HBar name="Complaints" data={COMPLAINT_STATUSES.map((s) => ({ label: COMPLAINT_STATUS_LABELS[s], count: r.totals[s] }))} />
            </ChartCard>
            <ChartCard
              title="By category"
              empty={empty}
              emptyText={EMPTY}
              table={<TwinTable caption="Complaints by category" head={['Category', 'Complaints', 'Resolved']} rows={r.byCategory.map((c) => [c.name, c.count, c.resolved])} />}
            >
              <HBar name="Complaints" data={r.byCategory.map((c) => ({ label: c.name, count: c.count }))} />
            </ChartCard>
            <ChartCard
              title="By department"
              empty={empty}
              emptyText={EMPTY}
              table={<TwinTable caption="Complaints by department" head={['Department', 'Open', 'Resolved or closed']} rows={r.byDepartment.map((d) => [d.name, d.open, d.count - d.open])} />}
            >
              <ResponsiveContainer width="100%" height={barHeight(r.byDepartment.length)}>
                <BarChart
                  data={r.byDepartment.map((d) => ({ label: d.name, open: d.open, done: d.count - d.open }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                  barCategoryGap={4}
                >
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={deptAxis.width} tickFormatter={deptAxis.tickFormatter} tick={AXIS} axisLine={false} tickLine={false} />
                  <RTooltip cursor={{ fill: 'rgba(47,95,211,0.06)' }} content={<TooltipBox />} />
                  <Legend wrapperStyle={{ fontSize: 12.5 }} formatter={legendText} />
                  {/* 2 px surface gap between the stacked segments */}
                  <Bar dataKey="open" name="Open" stackId="d" fill={SLOT1} stroke="#fff" strokeWidth={2} maxBarSize={18} />
                  <Bar dataKey="done" name="Resolved or closed" stackId="d" fill={SLOT2} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Backlog age (open now)"
              table={
                <TwinTable
                  caption="Open complaints by age"
                  head={['Age', 'Complaints']}
                  rows={[
                    ['Under 2 days', r.aging.under2Days],
                    ['2–7 days', r.aging.from2To7Days],
                    ['Over 7 days', r.aging.over7Days],
                  ]}
                />
              }
            >
              <div className="py-6">
                <SegmentedBar
                  label="Open complaints by age"
                  emptyText="No open complaints."
                  parts={[
                    { key: 'u2', name: 'Under 2 days', value: r.aging.under2Days, color: STATUS_FILL.approved! },
                    { key: 'w', name: '2–7 days', value: r.aging.from2To7Days, color: STATUS_FILL.pending! },
                    { key: 'o', name: 'Over 7 days (overdue)', value: r.aging.over7Days, color: STATUS_FILL.rejected! },
                  ]}
                />
              </div>
            </ChartCard>
            <ChartCard
              title="Top venues with issues"
              empty={!r.byVenue.length}
              emptyText="No complaints linked to venues."
              table={<TwinTable caption="Complaints by venue" head={['Venue', 'Complaints']} rows={r.byVenue.map((v) => [v.name, v.count])} />}
            >
              <HBar name="Complaints" data={r.byVenue.map((v) => ({ label: v.name, count: v.count }))} />
            </ChartCard>
            <ChartCard
              title="By reporter role"
              empty={empty}
              emptyText={EMPTY}
              table={<TwinTable caption="Complaints by reporter role" head={['Role', 'Complaints']} rows={r.byReporterRole.map((x) => [ROLE_LABELS[x.role], x.count])} />}
            >
              <HBar name="Complaints" data={r.byReporterRole.map((x) => ({ label: ROLE_LABELS[x.role], count: x.count }))} />
            </ChartCard>
          </div>

          <section>
            <h2 className="eyebrow mb-2.5">Department performance</h2>
            <TableShell>
              <Table>
                <THead>
                  <tr>
                    <TH>Department</TH>
                    <TH>Submitted</TH>
                    <TH>Open</TH>
                    <TH>Overdue</TH>
                    <TH>Avg. time to resolve</TH>
                  </tr>
                </THead>
                <tbody>
                  {r.byDepartment.length === 0 ? (
                    <TR>
                      <TD colSpan={5} className="text-center text-muted">
                        {EMPTY}
                      </TD>
                    </TR>
                  ) : (
                    r.byDepartment.map((d) => (
                      <TR key={d.departmentId}>
                        <TD className="font-semibold text-ink">{d.name}</TD>
                        <TD className="tabular">{d.count}</TD>
                        <TD className="tabular">{d.open}</TD>
                        <TD className={cn('tabular', d.overdue > 0 && 'font-semibold text-warning-text')}>{d.overdue}</TD>
                        <TD className="tabular">{hours(d.avgHoursToResolve)}</TD>
                      </TR>
                    ))
                  )}
                </tbody>
              </Table>
            </TableShell>
          </section>
        </div>
      )}
    </div>
  );
}

