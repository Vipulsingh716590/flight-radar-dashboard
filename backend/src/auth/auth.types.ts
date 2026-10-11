export type Role = 'admin' | 'viewer';

export const ROLES: readonly Role[] = ['admin', 'viewer'];

export interface User {
  email: string;
  passwordHash: string;
  role: Role;
}

/** What is safe to send to the browser and to attach to a request. */
export interface SessionUser {
  email: string;
  role: Role;
  /** Token expiry, epoch seconds. */
  exp: number;
}

export const USER_STORE = Symbol('USER_STORE');

/** Phase 4 replaces the in-memory implementation with the PostgreSQL users table. */
export interface UserStore {
  findByEmail(email: string): Promise<User | null>;
}
