// Date picker (popover + calendar) and time select at the configured step.
import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarDays, Clock } from 'lucide-react';
import { buildTimeOptions } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { inputBase } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { Calendar } from '@/components/ui/calendar';
import { Select } from '@/components/ui/select';

const toIso = (d: Date) => format(d, 'yyyy-MM-dd');

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  id,
  invalid,
  describedBy,
  className,
  disabled,
}: {
  value: string | null;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseISO(value) : undefined;
  const disabledDays = [...(min ? [{ before: parseISO(min) }] : []), ...(max ? [{ after: parseISO(max) }] : [])];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(inputBase, 'flex h-11 items-center gap-2 text-left md:h-10', !value && 'text-subtle', className)}
        >
          <CalendarDays className="size-[18px] shrink-0 text-muted" aria-hidden />
          <span className="tabular flex-1 truncate">{selected ? format(selected, 'EEE, d MMM yyyy') : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (min ? parseISO(min) : undefined)}
          startMonth={min ? parseISO(min) : undefined}
          endMonth={max ? parseISO(max) : undefined}
          disabled={disabledDays}
          onSelect={(d) => {
            if (d) {
              onChange(toIso(d));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TimeSelect({
  value,
  onChange,
  open,
  close,
  step,
  isDisabled,
  placeholder = 'Select time',
  id,
  invalid,
  describedBy,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  open: string;
  close: string;
  step: number;
  /** Returns a short reason when the option is unavailable (shown as a hint). */
  isDisabled?: (t: string) => string | false;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const options = React.useMemo(() => buildTimeOptions(open, close, step), [open, close, step]);
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onValueChange={onChange}
      invalid={invalid}
      describedBy={describedBy}
      placeholder={placeholder}
      icon={<Clock />}
      className={cn('tabular', className)}
      options={options.map((t) => {
        const reason = isDisabled?.(t) || false;
        return { value: t, label: t, disabled: !!reason, hint: reason || undefined };
      })}
    />
  );
}
