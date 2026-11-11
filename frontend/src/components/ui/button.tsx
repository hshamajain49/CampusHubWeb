import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'press relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold',
    'transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-[18px]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(20,27,45,0.12)] hover:bg-primary-hover',
        secondary: 'bg-surface-muted text-ink hover:bg-[#E5E9F2]',
        outline: 'border border-border bg-surface text-primary shadow-[0_1px_1px_rgba(20,27,45,0.04)] hover:border-[#CCD4E4] hover:bg-primary-soft/50',
        ghost: 'text-ink hover:bg-surface-muted',
        destructive: 'bg-destructive text-white shadow-[0_1px_2px_rgba(20,27,45,0.12)] hover:bg-[#C73E3E]',
        'destructive-outline':
          'border border-destructive/35 bg-surface text-destructive-text hover:border-destructive/60 hover:bg-destructive-soft/70',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline active:scale-100',
        success: 'bg-success text-white hover:bg-[#178452]',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        default: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-10',
        'icon-sm': 'size-8 rounded-[8px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button';
    const parts = React.Children.toArray(children);
    // While loading, the spinner replaces the leading icon; the label stays (§19.6).
    const content = loading && parts.length > 1 && React.isValidElement(parts[0]) ? parts.slice(1) : parts;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Spinner className="size-4" />}
            {content}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
