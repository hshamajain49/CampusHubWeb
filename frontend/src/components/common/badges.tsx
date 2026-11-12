import { Ban, BriefcaseBusiness, CircleCheck, CircleX, GraduationCap, Hourglass, ShieldCheck, TimerOff, Wrench } from 'lucide-react';
import { ROLE_LABELS, STATUS_LABELS, type BookingStatus, type Role } from '@campushub/shared';
import { cn } from '@/lib/utils';

const STATUS: Record<BookingStatus, { cls: string; icon: typeof Hourglass }> = {
  pending: { cls: 'bg-[#FDF4DC] text-[#7A5A00]', icon: Hourglass },
  approved: { cls: 'bg-[#E3F5EC] text-[#146C43]', icon: CircleCheck },
  rejected: { cls: 'bg-[#FCE8E8] text-[#A52A2A]', icon: CircleX },
  cancelled: { cls: 'bg-[#EEF0F4] text-[#4A5468]', icon: Ban },
  expired: { cls: 'bg-[#FDEEDD] text-[#9A5410]', icon: TimerOff },
};

/** Status is never conveyed by colour alone: icon + label (§19.9). */
export function StatusBadge({ status, className, size = 'md' }: { status: BookingStatus; className?: string; size?: 'sm' | 'md' }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'chip inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[11px] [&_svg]:size-3' : 'px-2.5 py-[3px] text-[12px] [&_svg]:size-3.5',
        s.cls,
        className,
      )}
    >
      <Icon aria-hidden strokeWidth={2.4} />
      {STATUS_LABELS[status]}
    </span>
  );
}

const ROLE: Record<Role, { cls: string; icon: typeof GraduationCap }> = {
  student: { cls: 'bg-primary-soft text-role-student', icon: GraduationCap },
  faculty_staff: { cls: 'bg-secondary-soft text-role-faculty', icon: BriefcaseBusiness },
  department_staff: { cls: 'bg-[#FDEEDD] text-[#9A5410]', icon: Wrench },
  super_admin: { cls: 'bg-[#F1EBFE] text-role-admin', icon: ShieldCheck },
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const r = ROLE[role];
  const Icon = r.icon;
  return (
    <span className={cn('chip inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold [&_svg]:size-3', r.cls, className)}>
      <Icon aria-hidden strokeWidth={2.4} />
      {ROLE_LABELS[role]}
    </span>
  );
}

export function Pill({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'teal'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-muted text-muted',
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success-text',
    warning: 'bg-warning-soft text-warning-text',
    danger: 'bg-destructive-soft text-destructive-text',
    teal: 'bg-secondary-soft text-secondary-text',
  };
  return <span className={cn('chip inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold [&_svg]:size-3', tones[tone], className)}>{children}</span>;
}

export const roleColor: Record<Role, string> = { student: '#1E3A8A', faculty_staff: '#0F766E', department_staff: '#9A5410', super_admin: '#7C3AED' };
