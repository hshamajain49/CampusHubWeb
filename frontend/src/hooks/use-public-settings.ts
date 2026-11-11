import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { campusNow, type CampusNow, type PublicSettings } from '@campushub/shared';
import { apiFetch } from '@/lib/api-client';

let clockOffset = 0;

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => {
      const s = await apiFetch<PublicSettings>('/settings/public');
      clockOffset = new Date(s.serverTime.timestamp).getTime() - Date.now(); // correct client clock skew (EC-34)
      return s;
    },
    staleTime: 5 * 60_000,
  });
}

export function getClockOffset() {
  return clockOffset;
}

/** Campus "now" (server-corrected), refreshed every 30 s. */
export function useCampusNow(): CampusNow | null {
  const { data } = usePublicSettings();
  const tz = data?.campusTimezone;
  const [now, setNow] = React.useState<CampusNow | null>(() => (tz ? campusNow(tz, clockOffset) : null));
  React.useEffect(() => {
    if (!tz) return;
    setNow(campusNow(tz, clockOffset));
    const t = setInterval(() => setNow(campusNow(tz, clockOffset)), 30_000);
    return () => clearInterval(t);
  }, [tz]);
  return now;
}
