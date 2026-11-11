import * as React from 'react';
import { Link, Outlet, useLocation, useNavigation } from 'react-router';
import { LogOut, UserRound } from 'lucide-react';
import { ROLE_LABELS, type Me } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus';
import { UserAvatar } from '@/components/common/small';

export function UserMenu({ me, profilePath, showName = true }: { me: Me; profilePath: string; showName?: boolean }) {
  const { signOut } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="press flex items-center gap-2.5 rounded-[12px] p-1 pr-1.5 transition-colors duration-150 hover:bg-surface-muted"
          aria-label={`Account menu for ${me.fullName}`}
        >
          <UserAvatar name={me.fullName} role={me.role} size={32} />
          {showName && (
            <span className="hidden max-w-[160px] text-left leading-tight lg:block">
              <span className="block truncate text-[13px] font-semibold text-ink">{me.fullName}</span>
              <span className="block text-[11.5px] text-muted">{ROLE_LABELS[me.role]}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-semibold text-ink">{me.fullName}</p>
          <p className="truncate text-[12.5px] text-muted">{me.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={profilePath}>
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void signOut('signed_out')}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Content area with the route fade (200 ms, §19.7) and a thin top progress hint while loaders run. */
export function AnimatedOutlet() {
  const loc = useLocation();
  const nav = useNavigation();
  return (
    <>
      {nav.state === 'loading' && <div className="fixed inset-x-0 top-0 z-[90] h-0.5 bg-primary/70" aria-hidden />}
      <div key={loc.pathname} className="page-enter">
        <Outlet />
      </div>
    </>
  );
}

export function AppFooter() {
  const { data } = usePublicSettings();
  if (!data) return null;
  return (
    <footer className="border-t border-border/70 px-4 py-6 text-center text-[12px] text-muted md:px-6 lg:px-8">
      {data.institutionName} · All times are in campus time ({data.campusTimezone})
      {data.supportEmail && (
        <>
          {' · '}
          <a href={`mailto:${data.supportEmail}`} className="font-medium text-primary hover:underline">
            {data.supportEmail}
          </a>
        </>
      )}
    </footer>
  );
}

export function NavLinkItem({
  to,
  active,
  children,
  className,
  onClick,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link to={to} onClick={onClick} aria-current={active ? 'page' : undefined} className={cn(className)}>
      {children}
    </Link>
  );
}
