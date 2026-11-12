import type { Role } from '@campushub/shared';

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department: string | null;
  service_department_id: string | null;
  /** Joined by loadProfile (null unless department_staff). */
  service_department_name?: string | null;
  service_department_active?: boolean | null;
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
      /** Set by requireServiceDepartment for the staff workspace. */
      serviceDepartment?: { id: string; name: string };
      valid: { params: any; query: any; body: any };
    }
  }
}

export {};
