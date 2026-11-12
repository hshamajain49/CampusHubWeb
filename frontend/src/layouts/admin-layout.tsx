import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  Megaphone,
  Tags,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import type { AdminDashboard } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { readPref, writePref } from '@/lib/session-token';
import { useAuth, useMe } from '@/providers/auth-provider';
import { usePollingInterval } from '@/providers/realtime-provider';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/menus';
import { Logo, Wordmark } from '@/components/common/brand';
import { NotificationBell } from '@/components/common/notification-bell';
import { TimezoneBanner, WakingBanner } from '@/components/common/banners';
import { Breadcrumb } from '@/components/common/layout-bits';
import { SkipLink, UserAvatar } from '@/components/common/small';
import { AnimatedOutlet, UserMenu } from './shell-parts';
import { adminPages, usePrefetchPages } from '@/routes/pages';

export function useAdminDashboard() {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => apiFetch<AdminDashboard>('/admin/dashboard'),
    staleTime: 15_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}

// Breadcrumb for the top bar: pages publish their trail; a default is derived from the section.
type Crumb = { label: string; to?: string };
const CrumbContext = React.createContext<(c: Crumb[] | null) => void>(() => {});
export function useAdminBreadcrumb(crumbs: Crumb[] | null) {
  const set = React.useContext(CrumbContext);
  const key = JSON.stringify(crumbs);
  React.useEffect(() => {
    set(crumbs);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

const GROUPS = [
  { label: 'Overview', items: [{ to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Bookings',
    items: [
      { to: '/admin/approvals', label: 'Approvals', icon: ClipboardCheck, badge: 'approvals' },
      { to: '/admin/bookings', label: 'All bookings', icon: CalendarDays },
      { to: '/admin/calendar', label: 'Calendar', icon: CalendarRange },
    ],
  },
  {
    label: 'Complaints',
    items: [
      { to: '/admin/complaints', label: 'All complaints', icon: Megaphone, badge: 'complaints' },
      { to: '/admin/complaint-setup', label: 'Departments & categories', icon: Tags },
    ],
  },
  {
    label: 'Resources',
    items: [
      { to: '/admin/venues', label: 'Venues', icon: Building2 },
      { to: '/admin/users', label: 'Users', icon: Users },
    ],
  },
  { label: 'Insights', items: [{ to: '/admin/reports', label: 'Reports', icon: ChartColumn }] },
  {
    label: 'System',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: Settings, exact: true },
      { to: '/admin/settings/audit-log', label: 'Audit log', icon: ScrollText },
    ],
  },
] as const;

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  approvals: 'Approvals',
  bookings: 'All bookings',
  calendar: 'Calendar',
  complaints: 'All complaints',
  'complaint-setup': 'Departments & categories',
  venues: 'Venues',
  users: 'Users',
  reports: 'Reports',
  settings: 'Settings',
  profile: 'Profile',
  notifications: 'Notifications',
};

type Badges = { approvals: number; complaints: number };

function SidebarNav({ collapsed, badges, onNavigate }: { collapsed: boolean; badges: Badges; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Admin" className="grid gap-5">
      {GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed && <p className="eyebrow mb-1.5 px-3">{g.label}</p>}
          <ul className="grid gap-0.5">
            {g.items.map((it) => {
              const exact = 'exact' in it && it.exact;
              const active = exact ? pathname === it.to : pathname === it.to || pathname.startsWith(`${it.to}/`);
              const Icon = it.icon;
              const count = 'badge' in it ? badges[it.badge] : 0;
              const showBadge = count > 0;
              const link = (
                <Link
                  to={it.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? it.label : undefined}
                  className={cn(
                    'relative flex h-10 items-center gap-3 rounded-[10px] text-sm font-semibold transition-colors duration-150',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-muted hover:text-ink',
                  )}
                >
                  {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary" />}
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                  {showBadge &&
                    (collapsed ? (
                      <span className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-surface" />
                    ) : (
                      <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{count > 99 ? '99+' : count}</span>
                    ))}
                </Link>
              );
              return <li key={it.to}>{collapsed ? <Tooltip content={it.label} side="right">{link}</Tooltip> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Warm the admin screens after the shell mounts; Reports (charts) loads on demand. */
const { reports: _reports, ...ADMIN_PREFETCH } = adminPages;

export function AdminLayout() {
  const me = useMe();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = React.useState(() => readPref('admin.sidebarCollapsed') === '1');
  const [mobileOpen, setMobileOpen] = React.useState(false);
  usePrefetchPages(ADMIN_PREFETCH);
  const [crumbs, setCrumbs] = React.useState<Crumb[] | null>(null);
  const dash = useAdminDashboard();
  const pending = dash.data?.kpis.pendingCount ?? 0;
  // All complaints: open complaints needing reassignment + new today (§8.2).
  const ck = dash.data?.complaintKpis;
  const badges: Badges = { approvals: pending, complaints: ck ? ck.needsReassignment + ck.newToday : 0 };

  const section = pathname.split('/')[2] ?? 'dashboard';
  const trail = crumbs ?? [{ label: pathname.startsWith('/admin/settings/audit-log') ? 'Audit log' : (SECTION_LABELS[section] ?? 'Admin') }];

  const toggle = () => {
    setCollapsed((c) => {
      writePref('admin.sidebarCollapsed', c ? '0' : '1');
      return !c;
    });
  };

  return (
    <CrumbContext.Provider value={setCrumbs}>
      <div className="flex min-h-dvh">
        <SkipLink />
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface lg:flex',
            collapsed ? 'w-[72px]' : 'w-64',
          )}
        >
          <div className={cn('flex h-16 items-center gap-2.5 border-b border-border', collapsed ? 'justify-center px-0' : 'px-5')}>
            <Link to="/admin/dashboard" className="flex items-center gap-2.5" aria-label="Admin dashboard">
              <Logo size={32} />
              {!collapsed && <Wordmark admin />}
            </Link>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto py-5', collapsed ? 'px-3' : 'px-3')}>
            <SidebarNav collapsed={collapsed} badges={badges} />
          </div>
          <div className="border-t border-border p-3">
            {!collapsed ? (
              <div className="rounded-[12px] bg-surface-muted p-3">
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={me.fullName} role={me.role} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{me.fullName}</p>
                    <p className="text-[11.5px] text-muted">Super Admin</p>
                  </div>
                </div>
                <div className="mt-2.5 flex gap-1">
                  <Link to="/admin/profile" className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-semibold text-ink hover:bg-white">
                    <UserRound className="size-3.5" /> Profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => void signOut('signed_out')}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-semibold text-destructive-text hover:bg-white"
                  >
                    <LogOut className="size-3.5" /> Sign out
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={toggle}
              className={cn('mt-2 flex h-9 w-full items-center gap-2 rounded-[9px] px-3 text-[12.5px] font-semibold text-muted hover:bg-surface-muted hover:text-ink', collapsed && 'justify-center px-0')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
              {!collapsed && 'Collapse'}
            </button>
          </div>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" title="Admin menu" hideTitle>
            <div className="px-3 pb-6">
              <div className="flex items-center gap-2.5 px-2 pb-5">
                <Logo size={32} />
                <Wordmark admin />
              </div>
              <SidebarNav collapsed={false} badges={badges} onNavigate={() => setMobileOpen(false)} />
              <div className="mt-6 grid gap-1 border-t border-border pt-4">
                <Link to="/admin/profile" onClick={() => setMobileOpen(false)} className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-semibold text-ink hover:bg-surface-muted">
                  <UserRound className="size-[18px]" /> Profile
                </Link>
                <button type="button" onClick={() => void signOut('signed_out')} className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-semibold text-destructive-text hover:bg-destructive-soft">
                  <LogOut className="size-[18px]" /> Sign out
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-[6px] supports-[backdrop-filter]:bg-surface/85">
            <div className="flex h-16 items-center gap-3 px-4 md:px-6 lg:px-8">
              <button
                type="button"
                className="press -ml-1.5 grid size-10 place-items-center rounded-[10px] text-ink hover:bg-surface-muted lg:hidden"
                aria-label="Open menu"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="size-[22px]" />
              </button>
              <Link to="/admin/dashboard" className="flex items-center gap-2 md:hidden" aria-label="Admin dashboard">
                <Logo size={30} />
              </Link>
              <Breadcrumb items={trail} className="hidden md:flex" />
              <div className="ml-auto flex items-center gap-1.5">
                <NotificationBell allPath="/admin/notifications" />
                <UserMenu me={me} profilePath="/admin/profile" />
              </div>
            </div>
            <WakingBanner />
            <TimezoneBanner />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 lg:px-8">
            <AnimatedOutlet />
          </main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}
