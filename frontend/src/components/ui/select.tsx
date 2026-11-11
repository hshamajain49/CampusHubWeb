import * as React from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputBase } from './input';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  hint?: string;
}

/** Accessible select (Radix). `value=''` shows the placeholder. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  icon,
  className,
  id,
  disabled,
  invalid,
  describedBy,
  'aria-label': ariaLabel,
  contentClassName,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  'aria-label'?: string;
  contentClassName?: string;
}) {
  return (
    <S.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          inputBase,
          'flex h-11 items-center gap-2 text-left md:h-10 data-[placeholder]:text-subtle [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate',
          className,
        )}
      >
        {icon && <span className="flex !flex-none text-muted [&_svg]:size-[18px]">{icon}</span>}
        <S.Value placeholder={placeholder} />
        <S.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'popover-surface z-[70] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[12px] border border-border bg-surface shadow-raised',
            contentClassName,
          )}
        >
          <S.Viewport className="p-1.5">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-9 cursor-default select-none items-center gap-2 rounded-[8px] pl-2.5 pr-8 text-sm text-ink outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-muted data-[disabled]:text-subtle"
              >
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="ml-auto text-[12px] text-subtle">{o.hint}</span>}
                <S.ItemIndicator className="absolute right-2.5">
                  <Check className="size-4 text-primary" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
