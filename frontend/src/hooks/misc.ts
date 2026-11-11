import * as React from 'react';
import { APP_NAME } from '@/lib/utils';

export function useDocumentTitle(title: string | null | undefined) {
  React.useEffect(() => {
    document.title = title ? `${title} · CampusHub` : APP_NAME;
  }, [title]);
}

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setMatches(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsMdUp = () => useMediaQuery('(min-width: 768px)');

export function usePageVisible(): boolean {
  const [visible, setVisible] = React.useState(() => document.visibilityState === 'visible');
  React.useEffect(() => {
    const h = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);
  return visible;
}
