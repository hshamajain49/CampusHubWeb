// Tiny store for the "Waking up the server…" banner (§9.5, free-tier cold starts).
import { useSyncExternalStore } from 'react';

let wakingUp = false;
let apiWarm = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function markApiWarm() {
  if (apiWarm && !wakingUp) return;
  apiWarm = true;
  if (wakingUp) {
    wakingUp = false;
    emit();
  }
}

export function startSlowTimer(): () => void {
  if (apiWarm) return () => {};
  const t = setTimeout(() => {
    if (!apiWarm && !wakingUp) {
      wakingUp = true;
      emit();
    }
  }, 3000);
  return () => clearTimeout(t);
}

export function useWakingUp(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => wakingUp,
    () => false,
  );
}
