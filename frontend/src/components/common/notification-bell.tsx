import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Ban, Bell, BellRing, CircleCheck, CircleX, Inbox, PencilLine, TimerOff } from 'lucide-react';
import type { NotificationItem as Item, NotificationType } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/format';
import { useIsMdUp } from '@/hooks/misc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/controls';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '@/features/notifications/api';

const TYPE: Record<NotificationType, { icon: typeof Bell; cls: string }> = {
  booking_approved: { icon: CircleCheck, cls: 'bg-success-soft text-success-text' },
  booking_rejected: { icon: CircleX, cls: 'bg-destructive-soft text-destructive-text' },
  booking_cancelled: { icon: Ban, cls: 'bg-surface-muted text-[#4A5468]' },
  booking_expired: { icon: TimerOff, cls: 'bg-[#FDEEDD] text-[#9A5410]' },
  booking_reminder: { icon: BellRing, cls: 'bg-primary-soft text-primary' },
  admin_new_request: { icon: Inbox, cls: 'bg-primary-soft text-primary' },
  admin_request_modified: { icon: PencilLine, cls: 'bg-secondary-soft text-secondary-text' },
  admin_booking_cancelled: { icon: Ban, cls: 'bg-surface-muted text-[#4A5468]' },
};

export function NotificationItem({ n, onOpen, className }: { n: Item; onOpen: (n: Item) => void; className?: string }) {
  const t = TYPE[n.type];
  const Icon = t.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn('flex w-full gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-100 hover:bg-surface-muted', className)}
    >
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', t.cls)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('line-clamp-2 text-[13.5px] leading-5 text-ink', !n.isRead ? 'font-semibold' : 'font-medium')}>{n.title}</span>
        <span className="line-clamp-2 text-[12.5px] leading-[18px] text-muted">{n.body}</span>
        <span className="mt-0.5 block text-[11.5px] text-subtle">{timeAgo(n.createdAt)}</span>
      </span>
      {!n.isRead && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </button>
  );
}

function BellPanel({ allPath, onDone }: { allPath: string; onDone: () => void }) {
  const list = useNotifications({ page: 1, pageSize: 10 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const open = (n: Item) => {
    if (!n.isRead) markRead.mutate(n.id);
    onDone();
    if (n.linkPath) navigate(n.linkPath);
  };
  const unread = list.data?.meta.unreadCount ?? 0;
  return (
    <div className="flex max-h-[min(70dvh,520px)] flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
        <p className="font-display text-[15px] font-semibold text-ink">Notifications</p>
        <button
          type="button"
          disabled={!unread || markAll.isPending}
          onClick={() => markAll.mutate()}
          className="text-[12.5px] font-semibold text-primary hover:underline disabled:text-subtle disabled:no-underline"
        >
          Mark all as read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {list.isLoading ? (
          <div className="grid gap-2 p-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.data?.data.length ? (
          list.data.data.map((n) => <NotificationItem key={n.id} n={n} onOpen={open} />)
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-ink">You're all caught up</p>
            <p className="mt-1 text-[13px] text-muted">Notifications about your bookings will appear here.</p>
          </div>
        )}
      </div>
      <div className="border-t border-border px-3 pt-2">
        <Link to={allPath} onClick={onDone} className="block rounded-[8px] py-2 text-center text-[13px] font-semibold text-primary hover:bg-primary-soft/50">
          View all
        </Link>
      </div>
    </div>
  );
}

export function NotificationBell({ allPath }: { allPath: string }) {
  const [open, setOpen] = React.useState(false);
  const mdUp = useIsMdUp();
  const count = useUnreadCount().data?.count ?? 0;
  const label = count > 99 ? '99+' : String(count);
  const trigger = (
    <button
      type="button"
      aria-label={`Notifications, ${count} unread`}
      className="press relative grid size-10 place-items-center rounded-[10px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
    >
      <Bell className="size-[22px]" />
      {count > 0 && (
        <span className="tabular absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-surface">
          {label}
        </span>
      )}
    </button>
  );
  if (!mdUp) {
    return (
      <>
        <span onClick={() => setOpen(true)}>{trigger}</span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" title="Notifications" hideTitle>
            <div className="px-2 pb-2">{open && <BellPanel allPath={allPath} onDone={() => setOpen(false)} />}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-2">
        {open && <BellPanel allPath={allPath} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}
