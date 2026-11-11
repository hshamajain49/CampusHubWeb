import * as React from 'react';
import { Command } from 'cmdk';
import { Building2, Check, ChevronDown, Search, Users } from 'lucide-react';
import type { VenueSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/misc';
import { inputBase } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { Spinner } from '@/components/ui/spinner';
import { formatNumber } from '@/lib/format';
import { useVenues } from '@/features/venues/api';

/** Searchable combobox of active venues (server search via q, 300 ms debounce). */
export function VenueCombobox({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: VenueSummary | null;
  onChange: (v: VenueSummary) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const dq = useDebouncedValue(q.trim(), 300);
  const list = useVenues({ q: dq || undefined, pageSize: 50, sort: 'name:asc' });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(inputBase, 'flex h-11 items-center gap-2 text-left md:h-10', !value && 'text-subtle')}
        >
          <Building2 className="size-[18px] shrink-0 text-muted" aria-hidden />
          <span className="flex-1 truncate">{value ? value.name : 'Choose a venue'}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-32px))] p-0" align="start">
        <Command shouldFilter={false} label="Venues">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted" aria-hidden />
            <Command.Input value={q} onValueChange={setQ} placeholder="Search venues" className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle" />
            {list.isFetching && <Spinner className="size-4 text-muted" />}
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">No venues match.</Command.Empty>
            {(list.data?.data ?? []).map((v) => (
              <Command.Item
                key={v.id}
                value={v.id}
                onSelect={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className="flex cursor-default items-center gap-3 rounded-[8px] px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-surface-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{v.name}</span>
                  <span className="block truncate text-[12px] text-muted">{v.building}</span>
                </span>
                <span className="tabular inline-flex items-center gap-1 text-[12px] text-muted">
                  <Users className="size-3.5" /> {formatNumber(v.capacity)}
                </span>
                {value?.id === v.id && <Check className="size-4 text-primary" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
