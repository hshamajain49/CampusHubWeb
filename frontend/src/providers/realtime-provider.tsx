// Live updates over Ably (§9.14). Connects only while signed in, enabled, and the tab is visible;
// closes after 2 min hidden. When connected, polling is switched off (usePollingInterval).
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { navigate } from '@/lib/navigation';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { usePageVisible } from '@/hooks/misc';
import { useAuth } from './auth-provider';

type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'disconnected';
const RealtimeContext = React.createContext<RealtimeStatus>('off');

export function useRealtimeStatus() {
  return React.useContext(RealtimeContext);
}

/** Polling interval that turns off while realtime is connected (free-tier budget, §30.10). */
export function usePollingInterval(ms: number): number | false {
  return useRealtimeStatus() === 'connected' ? false : ms;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, profile } = useAuth();
  const { data: settings } = usePublicSettings();
  const visible = usePageVisible();
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<RealtimeStatus>('off');
  const [awake, setAwake] = React.useState(true);

  // Close after 2 minutes hidden; reopen when visible again.
  React.useEffect(() => {
    if (visible) return setAwake(true);
    const t = setTimeout(() => setAwake(false), 120_000);
    return () => clearTimeout(t);
  }, [visible]);

  const enabled = authStatus === 'authenticated' && !!profile && !profile.mustChangePassword && !!settings?.realtimeEnabled && awake;
  const userId = profile?.id;
  const isAdmin = profile?.role === 'super_admin';

  React.useEffect(() => {
    if (!enabled || !userId) {
      setStatus('off');
      return;
    }
    let client: any;
    let cancelled = false;
    setStatus('connecting');
    (async () => {
      try {
        const Ably = await import('ably');
        if (cancelled) return;
        client = new Ably.Realtime({
          authCallback: (_params, cb) => {
            apiFetch<any>('/realtime/token', { method: 'POST' }).then((t) => cb(null, t), (e) => cb(String(e?.message ?? e), null));
          },
          autoConnect: true,
          echoMessages: false,
        });
        client.connection.on((change: any) => {
          if (cancelled) return;
          setStatus(change.current === 'connected' ? 'connected' : change.current === 'connecting' ? 'connecting' : 'disconnected');
        });
        const mine = client.channels.get(`user:${userId}`);
        mine.subscribe('notification.created', (msg: any) => {
          qc.invalidateQueries({ queryKey: ['notifications'] });
          const d = msg.data ?? {};
          if (d.linkPath && window.location.pathname === d.linkPath) return;
          toast(d.title ?? 'New notification', d.linkPath ? { action: { label: 'View', onClick: () => navigate(d.linkPath) } } : undefined);
        });
        mine.subscribe('booking.updated', (msg: any) => {
          const id = msg.data?.bookingId;
          if (id) qc.invalidateQueries({ queryKey: ['booking', id] });
          qc.invalidateQueries({ queryKey: ['bookings', 'mine'] });
          qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
        });
        if (isAdmin) {
          client.channels.get('admins').subscribe('bookings.changed', (msg: any) => {
            const id = msg.data?.bookingId;
            qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
            if (id) qc.invalidateQueries({ queryKey: ['admin', 'booking', id] });
            qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
            qc.invalidateQueries({ queryKey: ['admin', 'calendar'] });
          });
        }
      } catch {
        if (!cancelled) setStatus('disconnected'); // never surfaced to users; polling resumes
      }
    })();
    return () => {
      cancelled = true;
      try {
        client?.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, userId, isAdmin, qc]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}
