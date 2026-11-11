import type { Role } from '@campushub/shared';

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department: string | null;
  is_active: boolean;
  must_change_password: boolean;
  email_notifications: boolean;
  last_sign_in_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: { userId: string; sessionId: string };
      profile?: ProfileRow;
      valid: { params: any; query: any; body: any };
    }
  }
}

export {};
