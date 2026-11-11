import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TableShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('card overflow-hidden', className)}><div className="overflow-x-auto">{children}</div></div>;
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-sm', className)} {...p} />;
}

export function THead({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-surface-muted', className)} {...p} />;
}

export function TH({
  className,
  sort,
  onSort,
  children,
  ...p
}: React.ThHTMLAttributes<HTMLTableCellElement> & { sort?: 'asc' | 'desc' | false; onSort?: () => void }) {
  const ariaSort = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : onSort ? 'none' : undefined;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('h-11 whitespace-nowrap px-4 text-[12px] font-semibold uppercase tracking-[0.5px] text-muted first:pl-5 last:pr-5', className)}
      {...p}
    >
      {onSort ? (
        <button type="button" onClick={onSort} className="inline-flex items-center gap-1.5 uppercase hover:text-ink">
          {children}
          {sort === 'asc' ? <ArrowUp className="size-3.5" /> : sort === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-50" />}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TR({ className, onClick, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-t border-border transition-colors duration-100',
        onClick && 'cursor-pointer hover:bg-primary-soft/40',
        className,
      )}
      {...p}
    />
  );
}

export function TD({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-[52px] px-4 align-middle first:pl-5 last:pr-5', className)} {...p} />;
}
