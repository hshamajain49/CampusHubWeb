// CategoryPicker + RoutingHint (§16.3): a radiogroup of category cards with arrow-key navigation, then
// "Will be sent to {department}" [SRC].
import * as React from 'react';
import { Check, Route } from 'lucide-react';
import type { ComplaintCategory } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { categoryIcon, onTint, tint } from '../lib/category-icons';

export function CategoryPicker({
  categories,
  value,
  onChange,
  invalid,
  describedBy,
  id,
}: {
  categories: ComplaintCategory[];
  value: string | null;
  onChange: (id: string) => void;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = categories.findIndex((c) => c.id === value);
  const focusAt = (i: number) => {
    const n = categories.length;
    const next = ((i % n) + n) % n;
    refs.current[next]?.focus();
    onChange(categories[next]!.id);
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(categories.length - 1);
    }
  };
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="What kind of issue is it?"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
    >
      {categories.map((c, i) => {
        const selected = c.id === value;
        const Icon = categoryIcon(c.icon);
        return (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(c.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'press flex min-h-[64px] items-center gap-2.5 rounded-[12px] border bg-surface p-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
              !selected && 'border-border hover:border-[#CCD4E4]',
              invalid && !value && 'border-destructive/50',
            )}
            style={selected ? { borderColor: c.color, borderWidth: 1.6, background: tint(c.color) } : undefined}
          >
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors duration-150"
              style={selected ? { background: c.color, color: '#fff' } : { background: tint(c.color), color: onTint(c.color) }}
            >
              {selected ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold leading-[18px] text-ink">{c.name}</span>
              <span className="block truncate text-[11.5px] leading-4 text-muted">{c.department.name}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function RoutingHint({ department }: { department: string }) {
  return (
    <p className="flex items-center gap-2 rounded-[10px] bg-primary-soft px-3 py-2 text-[13px] text-[#1F2F66]" aria-live="polite">
      <Route className="size-4 shrink-0 text-primary" aria-hidden />
      <span>
        Will be sent to <strong className="font-semibold">{department}</strong>
      </span>
    </p>
  );
}
