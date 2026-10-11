import bcrypt from 'bcryptjs';
import type { AuthConfig } from '../config/app-config.js';
import type { User, UserStore } from './auth.types.js';

/** bcrypt work factor: ~250 ms per hash on current hardware. */
export const BCRYPT_COST = 12;
const MIN_ADMIN_PASSWORD_LENGTH = 12;

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<string, User>();

  constructor(users: User[]) {
    for (const user of users) this.users.set(user.email.toLowerCase(), user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.get(email.trim().toLowerCase()) ?? null;
  }
}

/**
 * Validates the single seed admin from the environment. Fails
 * fast (with a clear message) rather than starting a server nobody can log in to.
 */
export async function resolveSeedAdmin(
  auth: AuthConfig,
): Promise<{ email: string; passwordHash: string }> {
  if (!auth.adminEmail) {
    throw new Error('ADMIN_EMAIL is not set. Add the seed admin to backend/.env (see .env.example).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auth.adminEmail)) {
    throw new Error('ADMIN_EMAIL is not a valid email address');
  }

  let passwordHash = auth.adminPasswordHash;
  if (passwordHash) {
    if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
      throw new Error('ADMIN_PASSWORD_HASH is not a valid bcrypt hash');
    }
  } else if (auth.adminPassword) {
    if (auth.adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      throw new Error(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
    }
    passwordHash = await bcrypt.hash(auth.adminPassword, BCRYPT_COST);
  } else {
    throw new Error('Set ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) in backend/.env');
  }

  return { email: auth.adminEmail, passwordHash };
}

/** In-memory store with just the seed admin (used by tests; production uses PostgreSQL). */
export async function createSeedUserStore(auth: AuthConfig): Promise<InMemoryUserStore> {
  const admin = await resolveSeedAdmin(auth);
  return new InMemoryUserStore([{ ...admin, role: 'admin' }]);
}
