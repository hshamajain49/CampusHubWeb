import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputBase = cn(
  'w-full min-w-0 rounded-[10px] border border-border bg-surface px-3 text-ink shadow-[0_1px_1px_rgba(20,27,45,0.03)]',
  'placeholder:text-subtle transition-[border-color,box-shadow] duration-150 ease-out',
  'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15',
  'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/15',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted',
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputBase, 'h-11 read-only:bg-surface-muted md:h-10', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; maxRows?: number }>(
  ({ className, autoGrow = false, maxRows = 6, onInput, ...props }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null);
    const grow = React.useCallback(() => {
      const el = inner.current;
      if (!el || !autoGrow) return;
      el.style.height = 'auto';
      const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
      el.style.height = `${Math.min(el.scrollHeight + 2, line * maxRows + 22)}px`;
    }, [autoGrow, maxRows]);
    React.useLayoutEffect(grow, [grow, props.value]);
    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        className={cn(inputBase, 'min-h-[84px] resize-none py-2.5 leading-5', className)}
        onInput={(e) => {
          grow();
          onInput?.(e);
        }}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-semibold leading-[18px] text-ink', className)} {...props} />;
}
