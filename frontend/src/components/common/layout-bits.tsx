import * as React from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; to?: string }[];
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && <Breadcrumb items={breadcrumb} className="mb-2" />}
        <h1 className="font-display text-[20px] font-semibold leading-7 text-ink sm:text-2xl sm:leading-8">{title}</h1>
        {description && <p className="mt-1 text-sm leading-5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{actions}</div>}
    </div>
  );
}

export function Breadcrumb({ items, className }: { items: { label: string; to?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-1 text-[13px] text-muted', className)}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
          {it.to ? (
            <Link to={it.to} className="truncate hover:text-ink">
              {it.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink" aria-current="page">
              {it.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/** White card with an uppercase overline title and an optional right action (§19.6). */
export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-4 md:px-5 md:pt-5">
          {title && <h2 className="eyebrow">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cn('p-4 md:p-5', title && 'pt-3 md:pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export function InfoRow({ icon: Icon, label, children }: { icon?: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      {Icon && (
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-muted text-muted">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-muted">{label}</div>
        <div className="mt-0.5 break-words text-sm text-ink">{children}</div>
      </div>
    </div>
  );
}

export function ViewAllLink({ to, children = 'View all' }: { to: string; children?: React.ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
      {children}
      <ArrowRight className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
    </Link>
  );
}

/** KPI card: tinted icon badge, Poppins value, label, optional detail and link (§19.6). */
export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  to,
  tone = 'primary',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  to?: string;
  tone?: 'primary' | 'teal' | 'pending' | 'approved' | 'neutral' | 'violet';
}) {
  const tones = {
    primary: ['bg-primary-soft text-primary', 'bg-primary'],
    teal: ['bg-secondary-soft text-secondary-text', 'bg-secondary'],
    pending: ['bg-warning-soft text-warning-text', 'bg-warning'],
    approved: ['bg-success-soft text-success-text', 'bg-success'],
    neutral: ['bg-surface-muted text-muted', 'bg-muted'],
    violet: ['bg-[#F1EBFE] text-role-admin', 'bg-role-admin'],
  }[tone];
  const body = (
    <>
      <span aria-hidden className={cn('pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-[0.07]', tones[1])} />
      <div className="flex items-start justify-between gap-3">
        <span className={cn('grid size-9 place-items-center rounded-[10px]', tones[0])}>
          <Icon className="size-[18px]" />
        </span>
        {to && <ArrowRight className="size-4 text-subtle transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-primary" />}
      </div>
      <div className="mt-4 font-display text-2xl font-semibold leading-8 text-ink">{value}</div>
      <div className="mt-0.5 text-[13px] font-medium text-muted">{label}</div>
      {detail && <div className="mt-1 text-[12px] text-subtle">{detail}</div>}
    </>
  );
  const cls = 'card group relative block overflow-hidden p-4 md:p-5';
  return to ? (
    <Link to={to} className={cn(cls, 'lift press')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
