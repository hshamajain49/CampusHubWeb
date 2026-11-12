// Staff workspace guard (COMPLAINT_REGISTRATION_SPEC.md §11.2): a department_staff profile's service department must
// exist and be active, else 403 DEPARTMENT_INACTIVE. Runs after requireRole('department_staff').
import type { RequestHandler } from 'express';
import { appError } from '../errors/app-error.js';

export const requireServiceDepartment: RequestHandler = (req, _res, next) => {
  const p = req.profile!;
  if (!p.service_department_id) {
    return next(appError('DEPARTMENT_INACTIVE', 'Your account has no department assigned. Contact the administrator.'));
  }
  if (!p.service_department_active) return next(appError('DEPARTMENT_INACTIVE'));
  req.serviceDepartment = { id: p.service_department_id, name: p.service_department_name ?? '' };
  next();
};
