// Shared report building blocks (A14 bookings tab, CA05 complaints tab). Palette validated with the dataviz validator
// (light surface): slot 1 #2F5FD3, slot 2 #14A39A. Every chart has a table twin; part-to-whole uses segmented bars.
import * as React from 'react';
import { useIsMdUp } from '@/hooks/misc';

/**
 * Category-axis sizing for horizontal bar charts. A fixed 130–170 px label column left phone bars ~60 px wide, so on
 * small screens labels get 96 px and are shortened; the full label stays in the tooltip and the table twin.
 */
export function useCategoryAxis(desktopWidth = 150) {
  const mdUp = useIsMdUp();
  return React.useMemo(
    () =>
      mdUp
        ? { width: desktopWidth, tickFormatter: (v: string) => v }
        : { width: 96, tickFormatter: (v: string) => (String(v).length > 14 ? `${String(v).slice(0, 13).trimEnd()}…` : String(v)) },
    [mdUp, desktopWidth],
  );
}

export const SLOT1 = '#2F5FD3';
export const SLOT2 = '#14A39A';
export const GRID = '#EEF1F6';
export const AXIS = { fontSize: 11.5, fill: '#5E6A82' };
export const STATUS_FILL: Record<string, string> = { approved: '#1F9D63', pending: '#D9A10B', rejected: '#DC4A4A', cancelled: '#7C879C', expired: '#EA8A1E' };

export function ChartCard({
  title,
  children,
  table,
  empty,
  emptyText = 'No bookings in this period.',
}: {
  title: string;
  children: React.ReactNode;
  table: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <section className="card p-4 md:p-5">
      <h2 className="eyebrow mb-3">{title}</h2>
      {empty ? <p className="grid h-[220px] place-items-center text-sm text-muted">{emptyText}</p> : children}
      <div className="sr-only">{table}</div>
    </section>
  );
}

export function TooltipBox({ active, payload, label, fmt }: { active?: boolean; payload?: any[]; label?: string; fmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-raised">
      <p className="mb-1 font-semibold text-ink">{fmt ? fmt(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          {p.name}: <span className="tabular font-semibold text-ink">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Tall segmented bar: one whole split into parts, labels inside when they fit (dataviz "Figures"). */
export function SegmentedBar({
  parts,
  label,
  emptyText = 'No bookings in this period.',
}: {
  parts: { key: string; name: string; value: number; color: string }[];
  label: string;
  emptyText?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <div>
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.value} (${Math.round((p.value / total) * 100)}%)`).join(', ')}`} className="flex h-7 w-full gap-0.5">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = p.value / total;
            return (
              <div
                key={p.key}
                title={`${p.name}: ${p.value} (${Math.round(share * 100)}%)`}
                className="flex items-center overflow-hidden rounded-[4px] px-2 text-[11.5px] font-semibold text-white"
                style={{ width: `${share * 100}%`, background: p.color }}
              >
                {share >= 0.1 && <span className="tabular">{Math.round(share * 100)}%</span>}
              </div>
            );
          })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            {p.name} <span className="tabular font-semibold text-ink">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[12.5px] font-medium text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[22px] font-semibold leading-7 text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-subtle">{hint}</p>}
    </div>
  );
}

