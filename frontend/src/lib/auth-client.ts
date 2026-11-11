// Better Auth client (§9.4): used only for sign-in, sign-out, request/reset password.
import { createAuthClient } from 'better-auth/client';
import { getToken, setToken } from './session-token';
import { API_ORIGIN } from './utils';

export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  basePath: '/api/auth',
  fetchOptions: {
    // Bearer tokens only — no cookies cross sites (§16.4), and the API answers CORS with credentials: false.
    credentials: 'omit',
    auth: { type: 'Bearer', token: () => getToken() ?? '' },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token'); // bearer plugin
      if (token) setToken(token);
    },
  },
});
