import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/input';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** Label above, helper and error below; errors are linked via aria-describedby and announced politely. */
export function Field({
  label,
  error,
  hint,
  optional,
  className,
  labelAction,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  optional?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {optional && <span className="ml-1.5 font-normal text-subtle">(optional)</span>}
        </Label>
        {labelAction}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-[12px] leading-4 text-muted">
          {hint}
        </p>
      )}
      <div aria-live="polite">
        {error && (
          <p id={errId} className="flex items-start gap-1.5 text-[12.5px] font-medium leading-[18px] text-destructive-text">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
