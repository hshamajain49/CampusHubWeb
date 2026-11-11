import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationItem as Item } from '@campushub/shared';
import { formatDate, campusDateOf } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { addDays } from '@campushub/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination, Segmented } from '@/components/common/small';
import { NotificationItem } from '@/components/common/notification-bell';
import { useMarkAllRead, useMarkRead, useNotifications } from './api';

export function NotificationsPage() {
  useDocumentTitle('Notifications');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const unreadOnly = params.get('filter') === 'unread';
  const page = Number(params.get('page') || 1);
  const list = useNotifications({ unreadOnly, page, pageSize: 20 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const tz = settings?.campusTimezone ?? 'UTC';

  const groups = React.useMemo(() => {
    const out: { label: string; items: Item[] }[] = [];
    for (const n of list.data?.data ?? []) {
      const d = campusDateOf(n.createdAt, tz);
      const label = now && d === now.date ? 'Today' : now && d === addDays(now.date, -1) ? 'Yesterday' : formatDate(d);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [list.data, tz, now]);

  const open = (n: Item) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.linkPath) navigate(n.linkPath);
  };

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="outline" disabled={!list.data?.meta.unreadCount || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <Segmented
        aria-label="Filter notifications"
        className="mb-4"
        value={unreadOnly ? 'unread' : 'all'}
        onChange={(v) => setParams(v === 'unread' ? { filter: 'unread' } : {}, { replace: true })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: list.data?.meta.unreadCount },
        ]}
      />
      {list.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : !list.data!.data.length ? (
        <div className="card">
          <EmptyState icon={Bell} title={unreadOnly ? 'No unread notifications.' : "You're all caught up"} message={unreadOnly ? undefined : 'Notifications about your bookings will appear here.'} />
        </div>
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="eyebrow mb-2 px-1">{g.label}</h2>
              <div className="card p-1.5">
                {g.items.map((n) => (
                  <NotificationItem key={n.id} n={n} onOpen={open} />
                ))}
              </div>
            </section>
          ))}
          <Pagination page={page} pageSize={20} total={list.data!.meta.total} onPage={(p) => setParams({ ...(unreadOnly ? { filter: 'unread' } : {}), page: String(p) })} />
        </div>
      )}
    </div>
  );
}
