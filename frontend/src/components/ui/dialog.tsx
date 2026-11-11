import * as React from 'react';
import { AlertDialog as AD, Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlayCls = 'overlay fixed inset-0 z-[60] bg-[rgba(20,27,45,0.45)]';
const surfaceCls =
  'modal-surface fixed left-1/2 top-1/2 z-[60] grid max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-[14px] border border-border bg-surface p-6 shadow-raised outline-none';

/** Modal: focus trapped, Escape/outside closes unless `busy` (§8.6). Stays centred — not origin-aware. */
export function DialogContent({
  className,
  children,
  busy = false,
  size = 'md',
  hideClose = false,
  dismissible = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & { busy?: boolean; size?: 'md' | 'lg'; hideClose?: boolean; dismissible?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className={overlayCls} />
      <D.Content
        className={cn(surfaceCls, size === 'lg' ? 'max-w-[520px]' : 'max-w-[480px]', className)}
        onEscapeKeyDown={(e) => (busy || !dismissible) && e.preventDefault()}
        onInteractOutside={(e) => (busy || !dismissible) && e.preventDefault()}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            disabled={busy}
            className="press absolute right-3 top-3 grid size-9 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-40"
            aria-label="Close"
          >
            <X className="size-[18px]" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto', className)} {...props} />;
}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<typeof D.Title>>(({ className, ...p }, ref) => (
  <D.Title ref={ref} className={cn('font-display text-[17px] font-semibold leading-6 text-ink', className)} {...p} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<typeof D.Description>>(
  ({ className, ...p }, ref) => <D.Description ref={ref} className={cn('text-sm leading-5 text-muted', className)} {...p} />,
);
DialogDescription.displayName = 'DialogDescription';

// Alert dialog for destructive confirmations: default focus lands on the safe (Cancel) action.
export const AlertDialog = AD.Root;
export const AlertDialogTrigger = AD.Trigger;
export const AlertDialogCancel = AD.Cancel;
export const AlertDialogAction = AD.Action;
export const AlertDialogTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<typeof AD.Title>>(({ className, ...p }, ref) => (
  <AD.Title ref={ref} className={cn('font-display text-[17px] font-semibold leading-6 text-ink', className)} {...p} />
));
AlertDialogTitle.displayName = 'AlertDialogTitle';
export const AlertDialogDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<typeof AD.Description>>(
  ({ className, ...p }, ref) => <AD.Description ref={ref} className={cn('text-sm leading-5 text-muted', className)} {...p} />,
);
AlertDialogDescription.displayName = 'AlertDialogDescription';

export function AlertDialogContent({
  className,
  busy = false,
  size = 'md',
  ...props
}: React.ComponentPropsWithoutRef<typeof AD.Content> & { busy?: boolean; size?: 'md' | 'lg' }) {
  return (
    <AD.Portal>
      <AD.Overlay className={overlayCls} />
      <AD.Content
        className={cn(surfaceCls, size === 'lg' ? 'max-w-[520px]' : 'max-w-[480px]', className)}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        {...props}
      />
    </AD.Portal>
  );
}
