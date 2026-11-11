import * as React from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** react-day-picker v9 styled to the design system. Week starts Monday; today outlined; disabled greyed. */
export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      weekStartsOn={1}
      showOutsideDays
      className={cn('p-1 text-sm', className)}
      classNames={{
        months: 'relative flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center font-display text-[15px] font-semibold text-ink',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'press grid size-8 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-30',
        button_next:
          'press grid size-8 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-30',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-10 text-center text-[11px] font-bold uppercase tracking-[0.6px] text-subtle',
        week: 'mt-1 flex',
        day: 'p-0 text-center',
        day_button:
          'press tabular grid size-10 place-items-center rounded-[9px] text-sm text-ink transition-colors duration-100 hover:bg-surface-muted disabled:cursor-not-allowed disabled:hover:bg-transparent',
        selected: '[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-white [&>button]:hover:bg-primary-hover',
        today: '[&>button]:font-semibold [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary/45',
        outside: '[&>button]:text-subtle',
        disabled: '[&>button]:text-[#C3CAD8] [&>button]:line-through [&>button]:decoration-[#D7DCE6]',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />),
      }}
      {...props}
    />
  );
}
