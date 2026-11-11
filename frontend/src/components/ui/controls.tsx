// Switch, checkbox, radio cards, tabs, separator, skeleton, alert.
import * as React from 'react';
import { Checkbox as CB, RadioGroup as RG, Switch as SW, Tabs as TB } from 'radix-ui';
import { Check, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...p }: React.ComponentPropsWithoutRef<typeof SW.Root>) {
  return (
    <SW.Root
      className={cn(
        'peer inline-flex h-6 w-[42px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-[#CBD2DE] transition-colors duration-200 ease-[ease]',
        'data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...p}
    >
      <SW.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(20,27,45,0.25)] transition-transform duration-200 ease-[var(--ease-out)] data-[state=checked]:translate-x-[18px]" />
    </SW.Root>
  );
}

export function Checkbox({ className, ...p }: React.ComponentPropsWithoutRef<typeof CB.Root>) {
  return (
    <CB.Root
      className={cn(
        'peer grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-[#BAC3D4] bg-surface transition-colors duration-150',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...p}
    >
      <CB.Indicator>
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </CB.Indicator>
    </CB.Root>
  );
}

export function RadioCards({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string; description?: string; icon?: React.ReactNode }[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <RG.Root value={value} onValueChange={onValueChange} aria-label={ariaLabel} className={cn('grid gap-2 sm:grid-cols-2', className)}>
      {options.map((o) => (
        <RG.Item
          key={o.value}
          value={o.value}
          className={cn(
            'press group flex items-start gap-3 rounded-[12px] border border-border bg-surface p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
            'hover:border-[#CCD4E4] data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft/50 data-[state=checked]:shadow-[0_0_0_3px_rgba(30,58,138,0.08)]',
          )}
        >
          <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-[#BAC3D4] bg-white group-data-[state=checked]:border-primary">
            <RG.Indicator className="size-2.5 rounded-full bg-primary" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink [&_svg]:size-4 [&_svg]:text-muted">
              {o.icon}
              {o.label}
            </span>
            {o.description && <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{o.description}</span>}
          </span>
        </RG.Item>
      ))}
    </RG.Root>
  );
}

export const Tabs = TB.Root;
export const TabsContent = TB.Content;

/** Segmented pill tabs on surface-muted with a white active indicator (§19.6). */
export function TabsList({ className, ...p }: React.ComponentPropsWithoutRef<typeof TB.List>) {
  return (
    <TB.List
      className={cn('scrollbar-none inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[12px] bg-surface-muted p-1', className)}
      {...p}
    />
  );
}

export function TabsTrigger({ className, ...p }: React.ComponentPropsWithoutRef<typeof TB.Trigger>) {
  return (
    <TB.Trigger
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-semibold text-muted transition-[color,background-color,box-shadow] duration-150',
        'hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_3px_rgba(20,27,45,0.1)]',
        className,
      )}
      {...p}
    />
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />;
}

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton rounded-[10px]', className)} {...p} />;
}

const alertStyles = {
  info: { cls: 'border-[#C9D5F2] bg-primary-soft/70 text-[#1F2F66]', icon: Info, iconCls: 'text-primary' },
  success: { cls: 'border-[#BFE5D1] bg-success-soft text-success-text', icon: CircleCheck, iconCls: 'text-success' },
  warning: { cls: 'border-[#F1DEA3] bg-warning-soft text-warning-text', icon: TriangleAlert, iconCls: 'text-warning' },
  error: { cls: 'border-[#F3C7C7] bg-destructive-soft text-destructive-text', icon: CircleAlert, iconCls: 'text-destructive' },
};

export function Alert({
  variant = 'info',
  title,
  children,
  className,
  action,
  icon,
}: {
  variant?: keyof typeof alertStyles;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const s = alertStyles[variant];
  const Icon = s.icon;
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-[12px] border px-3.5 py-3 text-[13px] leading-5', s.cls, className)}>
      <span className={cn('mt-px shrink-0 [&_svg]:size-[18px]', s.iconCls)}>{icon ?? <Icon />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-95')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
