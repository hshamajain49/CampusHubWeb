import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { CalendarDays, CalendarPlus, LayoutDashboard, LogOut, Menu, UserRound, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Logo, Wordmark } from '@/components/common/brand';
import { NotificationBell } from '@/components/common/notification-bell';
import { TimezoneBanner, WakingBanner } from '@/components/common/banners';
import { SkipLink, UserAvatar } from '@/components/common/small';
import { memberPages, usePrefetchPages } from '@/routes/pages';
import { AnimatedOutlet, AppFooter, UserMenu } from './shell-parts';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, match: (p: string) => p === '/dashboard' },
  { to: '/venues', label: 'Venues', icon: Building2, match: (p: string) => p.startsWith('/venues') },
  { to: '/bookings', label: 'My bookings', icon: CalendarDays, match: (p: string) => p.startsWith('/bookings') && p !== '/bookings/new' },
];

export function UserLayout() {
  const me = useMe();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = React.useState(false);
  usePrefetchPages(memberPages);

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
            <Wordmark className="max-[360px]:hidden" />
          </Link>
          <nav aria-label="Main" className="ml-6 hidden h-full items-stretch gap-1 md:flex">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center px-3 text-sm font-semibold transition-colors duration-150',
                    active ? 'text-primary' : 'text-muted hover:text-ink',
                  )}
                >
                  {n.label}
                  {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Button asChild className="hidden md:inline-flex">
              <Link to="/venues">
                <CalendarPlus /> Book a venue
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
              {[...NAV, { to: '/profile', label: 'Profile', icon: UserRound, match: (p: string) => p === '/profile' }].map((n) => {
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
                  </Link>
                );
              })}
            </nav>
            <Button asChild size="lg" className="mt-4">
              <Link to="/venues" onClick={() => setMenuOpen(false)}>
                <CalendarPlus /> Book a venue
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

      <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-6 lg:px-8">
        <AnimatedOutlet />
      </main>
      <AppFooter />
    </div>
  );
}
