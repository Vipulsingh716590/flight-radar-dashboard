import { SetMetadata } from '@nestjs/common';
import type { Role } from './auth.types.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';

/** Opts a route out of the global authentication guard (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the listed roles; any authenticated user passes when absent. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
