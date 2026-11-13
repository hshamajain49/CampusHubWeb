import * as React from 'react';
import { CloudOff, Inbox, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Large tinted icon in a double circle, title, message and an optional action (§19.6). */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  tone = 'primary',
  className,
  compact = false,
  titleAs: TitleTag = 'h2',
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  message?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'primary' | 'danger' | 'teal';
  className?: string;
  compact?: boolean;
  /** 'h1' when the empty state is the whole page (404); otherwise it sits under the page title. */
  titleAs?: 'h1' | 'h2';
}) {
  const tones = {
    primary: ['bg-primary/[0.06]', 'bg-primary/[0.12]', 'text-primary'],
    danger: ['bg-destructive/[0.06]', 'bg-destructive/[0.12]', 'text-destructive'],
    teal: ['bg-secondary/[0.07]', 'bg-secondary/[0.13]', 'text-secondary-text'],
  }[tone];
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-8' : 'py-14', className)}>
      <div className={cn('grid place-items-center rounded-full', compact ? 'size-20' : 'size-28', tones[0])}>
        <div className={cn('grid place-items-center rounded-full', compact ? 'size-14' : 'size-20', tones[1])}>
          <Icon className={cn(compact ? 'size-7' : 'size-9', tones[2])} aria-hidden />
        </div>
      </div>
      <TitleTag className={cn('mt-5 font-display font-semibold text-ink', compact ? 'text-base' : 'text-[19px] leading-[26px]')}>{title}</TitleTag>
      {message && <p className="mt-1.5 max-w-[420px] text-sm leading-5 text-muted">{message}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className, compact }: { message?: string; onRetry?: () => void; className?: string; compact?: boolean }) {
  return (
    <EmptyState
      icon={CloudOff}
      tone="danger"
      compact={compact}
      className={className}
      title="Something went wrong"
      message={message ?? "We couldn't load this page."}
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw /> Try again
          </Button>
        )
      }
    />
  );
}

/** Per-section inline error so one failing section doesn't blank the page. */
export function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-destructive-soft/60 px-3.5 py-3 text-[13px] text-destructive-text">
      <span className="flex items-center gap-2">
        <CloudOff className="size-4" /> Couldn't load.
      </span>
      <button type="button" onClick={onRetry} className="font-semibold underline-offset-2 hover:underline">
        Try again
      </button>
    </div>
  );
}
