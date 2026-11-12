import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { CalendarDays, CalendarPlus, Inbox, LayoutDashboard, LogOut, Megaphone, Menu, UserRound, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Logo, Wordmark } from '@/components/common/brand';
import { NotificationBell } from '@/components/common/notification-bell';
import { TimezoneBanner, WakingBanner } from '@/components/common/banners';
import { SkipLink, UserAvatar } from '@/components/common/small';
import { memberPages, staffPages, usePrefetchPages } from '@/routes/pages';
import { useMyComplaintCounts, useStaffDashboard } from '@/features/complaints/api';
import { AnimatedOutlet, AppFooter, UserMenu } from './shell-parts';

const NO_PAGES = {};

type NavItem = {
  to: string;
  label: string;
  /** Shorter label for the md–lg header, where five links must fit at 768 px. */
  short?: string;
  icon: typeof LayoutDashboard;
  match: (p: string) => boolean;
  badge?: number;
  badgeTone?: 'amber' | 'navy';
};

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, match: (p: string) => p === '/dashboard' },
  { to: '/venues', label: 'Venues', icon: Building2, match: (p: string) => p.startsWith('/venues') },
  { to: '/bookings', label: 'My bookings', icon: CalendarDays, match: (p: string) => p.startsWith('/bookings') && p !== '/bookings/new' },
  { to: '/complaints', label: 'Complaints', icon: Megaphone, match: (p: string) => p.startsWith('/complaints') },
];
const QUEUE: NavItem = { to: '/staff', label: 'Department queue', short: 'Queue', icon: Inbox, match: (p: string) => p.startsWith('/staff') };

function NavBadge({ n, tone, label }: { n?: number; tone?: 'amber' | 'navy'; label: string }) {
  if (!n) return null;
  return (
    <span
      className={cn('tabular ml-1.5 rounded-full px-1.5 text-[11px] font-bold leading-[18px] text-white', tone === 'navy' ? 'bg-primary' : 'bg-warning')}
      aria-label={label}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function StaffBadgeSource({ onCount }: { onCount: (n: number) => void }) {
  const dash = useStaffDashboard();
  const n = dash.data?.counts.new ?? 0;
  React.useEffect(() => onCount(n), [n, onCount]);
  return null;
}

export function UserLayout() {
  const me = useMe();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = React.useState(false);
  usePrefetchPages(memberPages);
  const isStaff = me.role === 'department_staff';
  usePrefetchPages(isStaff ? staffPages : NO_PAGES);
  const counts = useMyComplaintCounts();
  const [newInQueue, setNewInQueue] = React.useState(0);
  const review = counts.data?.awaitingYourReview ?? 0;
  const nav: NavItem[] = [
    ...NAV.map((n) => (n.to === '/complaints' ? { ...n, badge: review, badgeTone: 'amber' as const } : n)),
    ...(isStaff ? [{ ...QUEUE, badge: newInQueue, badgeTone: 'navy' as const }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-[6px] supports-[backdrop-filter]:bg-surface/85">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:px-6 lg:px-8">
          <button
            type="button"
            className="press -ml-1.5 grid size-10 place-items-center rounded-[10px] text-ink hover:bg-surface-muted md:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-[22px]" />
          </button>
          <Link to="/dashboard" className="flex items-center gap-2.5 rounded-[8px]" aria-label="CampusHub home">
            <Logo size={32} />
            <Wordmark className="max-[360px]:hidden md:max-lg:hidden" />
          </Link>
          <nav aria-label="Main" className="ml-3 hidden h-full items-stretch gap-0.5 md:flex lg:ml-6 lg:gap-1">
            {nav.map((n) => {
              const active = n.match(pathname);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center whitespace-nowrap px-2.5 text-sm font-semibold transition-colors duration-150 lg:px-3',
                    active ? 'text-primary' : 'text-muted hover:text-ink',
                  )}
                >
                  {n.short ? (
                    <>
                      <span className="lg:hidden">{n.short}</span>
                      <span className="hidden lg:inline">{n.label}</span>
                    </>
                  ) : (
                    n.label
                  )}
                  <NavBadge n={n.badge} tone={n.badgeTone} label={n.badgeTone === 'navy' ? `${n.badge} new` : `${n.badge} waiting for your review`} />
                  {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Button asChild variant="outline" className="hidden lg:inline-flex">
              <Link to="/complaints/new">
                <Megaphone /> Report an issue
              </Link>
            </Button>
            {/* Icon-only between md and lg so five nav links fit at 768 px. */}
            <Button asChild className="hidden md:inline-flex md:max-lg:w-10 md:max-lg:px-0">
              <Link to="/venues" aria-label="Book a venue">
                <CalendarPlus /> <span className="md:max-lg:sr-only">Book a venue</span>
              </Link>
            </Button>
            <NotificationBell allPath="/notifications" />
            <div className="hidden md:block">
              <UserMenu me={me} profilePath="/profile" />
            </div>
          </div>
        </div>
        <WakingBanner />
        <TimezoneBanner />
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" title="Menu" hideTitle>
          <div className="flex h-full flex-col px-3 pb-4">
            <div className="flex items-center gap-2.5 px-2 pb-4">
              <Logo size={32} />
              <Wordmark />
            </div>
            <div className="mx-1 mb-3 flex items-center gap-3 rounded-[12px] bg-surface-muted p-3">
              <UserAvatar name={me.fullName} role={me.role} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{me.fullName}</p>
                <p className="truncate text-[12.5px] text-muted">{me.email}</p>
              </div>
            </div>
            <nav aria-label="Main" className="grid gap-1">
              {[...nav, { to: '/profile', label: 'Profile', icon: UserRound, match: (p: string) => p === '/profile' } as NavItem].map((n) => {
                const active = n.match(pathname);
                const Icon = n.icon;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-semibold',
                      active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-muted',
                    )}
                  >
                    <Icon className="size-5" />
                    {n.label}
                    <NavBadge n={n.badge} tone={n.badgeTone} label={n.badgeTone === 'navy' ? `${n.badge} new` : `${n.badge} waiting for your review`} />
                  </Link>
                );
              })}
            </nav>
            <Button asChild size="lg" className="mt-4">
              <Link to="/venues" onClick={() => setMenuOpen(false)}>
                <CalendarPlus /> Book a venue
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="mt-2">
              <Link to="/complaints/new" onClick={() => setMenuOpen(false)}>
                <Megaphone /> Report an issue
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => void signOut('signed_out')}
              className="mt-auto flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-semibold text-destructive-text hover:bg-destructive-soft"
            >
              <LogOut className="size-5" /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {isStaff && <StaffBadgeSource onCount={setNewInQueue} />}
      <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-6 lg:px-8">
        <AnimatedOutlet />
      </main>
      <AppFooter />
    </div>
  );
}
