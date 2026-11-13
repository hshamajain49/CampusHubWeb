import * as React from 'react';
import { cn } from '@/lib/utils';

/** The logo tile: three slot bars — the product's motif — on the navy→teal brand gradient. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  // One gradient id per instance: url(#id) resolves to the FIRST element with that id, so a shared id breaks every
  // visible logo whenever an earlier copy sits in a display:none subtree (the admin sidebar on phones).
  const gradientId = `logo-g${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E3A8A" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <rect x="14" y="17" width="36" height="7" rx="3.5" fill="#fff" fillOpacity=".28" />
      <rect x="14" y="17" width="22" height="7" rx="3.5" fill="#fff" />
      <rect x="14" y="28.5" width="36" height="7" rx="3.5" fill="#fff" fillOpacity=".28" />
      <rect x="26" y="28.5" width="24" height="7" rx="3.5" fill="#fff" />
      <rect x="14" y="40" width="36" height="7" rx="3.5" fill="#fff" fillOpacity=".28" />
      <rect x="14" y="40" width="14" height="7" rx="3.5" fill="#F59E0B" />
    </svg>
  );
}

export function Wordmark({ className, invert = false, admin = false }: { className?: string; invert?: boolean; admin?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-[17px] font-semibold leading-none tracking-[-0.01em]', className)}>
      <span className={invert ? 'text-white' : 'text-ink'}>
        Campus<span className={invert ? 'text-[#7EE0D4]' : 'text-secondary'}>Hub</span>
      </span>
      {admin && (
        <span className="rounded-full bg-primary-soft px-2 py-0.5 font-sans text-[11px] font-bold uppercase tracking-[0.6px] text-primary">Admin</span>
      )}
    </span>
  );
}
