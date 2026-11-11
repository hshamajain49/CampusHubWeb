// All HTTP calls to /api/v1 (§9.5): bearer header, error normalisation, global auth handling, cold starts.
import type { ListMeta } from '@campushub/shared';
import { DEFAULT_ERROR_MESSAGES } from '@campushub/shared';
import { getToken } from './session-token';
import { markApiWarm, startSlowTimer } from './api-status';
import { API_ORIGIN } from './utils';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: any = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get fieldErrors(): Record<string, string[]> {
    return (this.details?.fieldErrors as Record<string, string[]>) ?? {};
  }
}

type Handlers = {
  onUnauthenticated: () => void;
  onDeactivated: () => void;
  onPasswordChangeRequired: () => void;
};
let handlers: Handlers = { onUnauthenticated: () => {}, onDeactivated: () => {}, onPasswordChangeRequired: () => {} };
export function setApiHandlers(h: Handlers) {
  handlers = h;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: object;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseType?: 'json' | 'blob' | 'text';
  /** Don't trigger the global sign-out on 401 (used by the initial /me probe). */
  silentAuth?: boolean;
}

export const API_BASE = `${API_ORIGIN}/api/v1`;

export function toQueryString(query?: object): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function raw(path: string, opts: ApiOptions = {}): Promise<{ res: Response; body: any }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-Id': crypto.randomUUID(), ...opts.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const timeout = AbortSignal.timeout(90_000); // long enough for a free-tier cold start
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const stopTimer = startSlowTimer();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${toQueryString(opts.query)}`, { method: opts.method ?? 'GET', headers, body, signal });
  } catch (err: any) {
    stopTimer();
    if (err?.name === 'AbortError' && opts.signal?.aborted) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', DEFAULT_ERROR_MESSAGES.NETWORK_ERROR!);
  }
  stopTimer();
  markApiWarm();

  if (res.status === 204) return { res, body: undefined };
  if (res.ok) {
    if (opts.responseType === 'blob') return { res, body: await res.blob() };
    if (opts.responseType === 'text') return { res, body: await res.text() };
    return { res, body: await res.json() };
  }

  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON error */
  }
  const e = parsed?.error;
  const err = e
    ? new ApiError(res.status, e.code, e.message, e.details, e.requestId)
    : new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR', DEFAULT_ERROR_MESSAGES.INTERNAL_ERROR!);
  if (res.status === 401 && !opts.silentAuth) handlers.onUnauthenticated();
  if (err.code === 'ACCOUNT_DEACTIVATED') handlers.onDeactivated();
  if (err.code === 'PASSWORD_CHANGE_REQUIRED') handlers.onPasswordChangeRequired();
  throw err;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body } = await raw(path, opts);
  if (opts.responseType === 'blob' || opts.responseType === 'text') return body as T;
  return (body?.data ?? body) as T;
}

export async function apiFetchList<T, M = Record<string, never>>(path: string, opts: ApiOptions = {}): Promise<{ data: T[]; meta: ListMeta & M }> {
  const { body } = await raw(path, opts);
  return body;
}

export async function apiFetchWithResponse<T>(path: string, opts: ApiOptions = {}): Promise<{ data: T; res: Response }> {
  const { res, body } = await raw(path, opts);
  // Blob/text bodies are already read by raw(); only JSON envelopes are unwrapped.
  const binary = opts.responseType === 'blob' || opts.responseType === 'text';
  return { data: (binary ? body : body?.data) as T, res };
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorMessage(e: unknown, fallback = "We couldn't load this page."): string {
  if (e instanceof ApiError) return e.message;
  return fallback;
}
