// Dropdown menu, popover and tooltip — all origin-aware (scale out of their trigger).
import * as React from 'react';
import { DropdownMenu as DM, Popover as P, Tooltip as T } from 'radix-ui';
import { cn } from '@/lib/utils';

const surface = 'popover-surface z-50 rounded-[12px] border border-border bg-surface p-1.5 shadow-raised outline-none';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = 'end', ...p }: React.ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} align={align} className={cn(surface, 'min-w-[200px]', className)} {...p} />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...p
}: React.ComponentPropsWithoutRef<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex h-9 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 text-sm text-ink outline-none transition-colors duration-100',
        'data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:text-muted',
        destructive && 'text-destructive-text data-[highlighted]:bg-destructive-soft [&_svg]:text-destructive-text',
        className,
      )}
      {...p}
    />
  );
}

export function DropdownMenuLabel({ className, ...p }: React.ComponentPropsWithoutRef<typeof DM.Label>) {
  return <DM.Label className={cn('px-2.5 py-2', className)} {...p} />;
}

export function DropdownMenuSeparator({ className, ...p }: React.ComponentPropsWithoutRef<typeof DM.Separator>) {
  return <DM.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...p} />;
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, sideOffset = 6, align = 'start', ...p }: React.ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={sideOffset} align={align} className={cn(surface, 'p-3', className)} {...p} />
    </P.Portal>
  );
}

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  // Once one tooltip is open, neighbours open instantly (skipDelayDuration).
  <T.Provider delayDuration={400} skipDelayDuration={400}>
    {children}
  </T.Provider>
);

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="popover-surface tooltip-surface z-[80] max-w-[260px] rounded-[8px] bg-ink px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-raised"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
