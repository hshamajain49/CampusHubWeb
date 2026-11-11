// Small shared pieces: avatar, pagination, copy button, skip link, segmented filter.
import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import type { Role } from '@campushub/shared';
import { cn, initials } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Tooltip } from '@/components/ui/menus';
import { Select } from '@/components/ui/select';
import { roleColor } from './badges';

export function UserAvatar({ name, role, size = 40, className }: { name: string; role?: Role; size?: 32 | 40 | 56 | 28; className?: string }) {
  const color = role ? roleColor[role] : '#1E3A8A';
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `${color}1A`, color }}
    >
      {initials(name)}
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizes,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  pageSizes?: number[];
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums: (number | '…')[] = [];
  const add = (n: number | '…') => nums[nums.length - 1] !== n && nums.push(n);
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) add(p);
    else add('…');
  }
  const btn = 'press tabular grid size-9 place-items-center rounded-[9px] text-sm font-semibold transition-colors duration-150 disabled:opacity-40';
  return (
    <nav aria-label="Pagination" className={cn('mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row', className)}>
      <p className="tabular text-[13px] text-muted">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-1">
        {onPageSize && pageSizes && (
          <Select
            aria-label="Rows per page"
            value={String(pageSize)}
            onValueChange={(v) => onPageSize(Number(v))}
            options={pageSizes.map((n) => ({ value: String(n), label: `${n} / page` }))}
            className="mr-2 h-9 w-[118px] md:h-9"
          />
        )}
        <button type="button" className={cn(btn, 'text-muted hover:bg-surface-muted')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="w-6 text-center text-subtle">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={cn(btn, n === page ? 'bg-primary text-white' : 'text-ink hover:bg-surface-muted')}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className={cn(btn, 'text-muted hover:bg-surface-muted')} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Tooltip content={copied ? 'Copied' : label}>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true))}
        className="press grid size-8 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
        aria-label={copied ? 'Copied' : label}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </Tooltip>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[100] rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
    >
      Skip to content
    </a>
  );
}

/** Segmented control for small filter sets ("All | Pending | Approved"). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  'aria-label': string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('scrollbar-none inline-flex max-w-full gap-1 overflow-x-auto rounded-[12px] bg-surface-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-semibold transition-[color,background-color,box-shadow] duration-150',
            value === o.value ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(20,27,45,0.1)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cn('tabular rounded-full px-1.5 text-[11px]', value === o.value ? 'bg-primary-soft text-primary' : 'bg-white/70 text-muted')}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
