import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

const sides = {
  right: 'sheet-right inset-y-0 right-0 h-dvh w-full max-w-[420px] border-l',
  left: 'sheet-left inset-y-0 left-0 h-dvh w-[86vw] max-w-[300px] border-r',
  bottom: 'sheet-bottom inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[20px] border-t safe-bottom',
};

/** Sheets slide with the iOS-like drawer curve; the bottom variant gets a grabber and safe-area padding. */
export function SheetContent({
  side = 'right',
  className,
  children,
  title,
  description,
  hideTitle = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & {
  side?: keyof typeof sides;
  title: string;
  description?: string;
  hideTitle?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="overlay fixed inset-0 z-[60] bg-[rgba(20,27,45,0.45)]" />
      <D.Content
        className={cn('fixed z-[60] flex flex-col border-border bg-surface shadow-raised outline-none', sides[side], className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        {side === 'bottom' && <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-[#D5DBE7]" />}
        <div className={cn('flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4', hideTitle && 'sr-only')}>
          <div className="min-w-0">
            <D.Title className="font-display text-[17px] font-semibold leading-6 text-ink">{title}</D.Title>
            {description && <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>}
          </div>
          <D.Close
            className="press -mr-1 grid size-9 shrink-0 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
            aria-label="Close"
          >
            <X className="size-[18px]" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
