// URL-synced filters (§9.6): every list screen keeps its filters in the query string.

/** A copy of `params` with each patched key set (non-empty) or removed (null/empty); page resets by default. */
export function patchParams(params: URLSearchParams, patch: Record<string, string | null>, resetPage = true): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  if (resetPage) next.delete('page');
  return next;
}
