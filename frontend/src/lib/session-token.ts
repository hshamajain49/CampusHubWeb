// Session token store (§9.4): localStorage with a memory fallback; other tabs sign out together.
const KEY = 'campushub.session';
let memory: string | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setToken(token: string): void {
  memory = token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable — memory only */
  }
}

export function clearToken(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function onTokenRemovedElsewhere(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === KEY && !e.newValue) cb();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** Safe localStorage helpers for per-viewer conveniences (banner dismissals, sidebar state). */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
