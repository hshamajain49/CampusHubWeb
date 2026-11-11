import * as React from 'react';
import { Globe, X } from 'lucide-react';
import { useWakingUp } from '@/lib/api-status';
import { readPref, writePref } from '@/lib/session-token';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Spinner } from '@/components/ui/spinner';

/** Free-tier cold start notice (§8.3, §9.5). */
export function WakingBanner() {
  const waking = useWakingUp();
  if (!waking) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-[#C9D5F2] bg-primary-soft px-4 py-2 text-[13px] font-medium text-[#1F2F66]">
      <Spinner className="size-4 text-primary" />
      Waking up the server… this can take up to a minute.
    </div>
  );
}

/** Shown when the browser timezone differs from campus time; dismissal is remembered (§8.3). */
export function TimezoneBanner() {
  const { data } = usePublicSettings();
  const [dismissed, setDismissed] = React.useState(() => readPref('tzBannerDismissed') === '1');
  const browserTz = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  if (!data || dismissed) return null;
  const same =
    new Intl.DateTimeFormat('en-GB', { timeZone: data.campusTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) ===
    new Intl.DateTimeFormat('en-GB', { timeZone: browserTz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  if (same) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 text-[13px] text-muted">
      <Globe className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="flex-1">Times are shown in campus time ({data.campusTimezone}).</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="press grid size-7 place-items-center rounded-[7px] hover:bg-surface-muted"
        onClick={() => {
          writePref('tzBannerDismissed', '1');
          setDismissed(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
