// Lets non-React modules (API client, auth provider) navigate with the data router once it exists.
type Navigate = (to: string, opts?: { replace?: boolean }) => void;
let navigateFn: Navigate = (to) => window.location.assign(to);

export function setNavigate(fn: Navigate) {
  navigateFn = fn;
}

export function navigate(to: string, opts?: { replace?: boolean }) {
  navigateFn(to, opts);
}

/** Only internal paths are honoured for redirectTo (§9.3). */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
