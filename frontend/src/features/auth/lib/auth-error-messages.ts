// Better Auth error → user message (§16.3). Flutter wording kept where it existed.
export function authErrorMessage(error: { code?: string; status?: number; message?: string } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  const code = error.code ?? '';
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || error.status === 401) return 'Incorrect email or password.';
  if (code === 'ACCOUNT_DEACTIVATED') return 'Your account has been deactivated. Contact an administrator.';
  if (error.status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (code === 'WEAK_PASSWORD' || code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG')
    return 'Password must be at least 8 characters and include a letter and a number.';
  if (code === 'INVALID_TOKEN') return 'This reset link is invalid or has expired. Request a new one.';
  if (error.status === 0 || code === 'NETWORK_ERROR') return 'No internet connection. Check your network and try again.';
  return 'Something went wrong. Please try again.';
}
