import { Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { DataSource } from 'typeorm';
import type { User, UserStore } from '../auth/auth.types.js';
import { resolveSeedAdmin } from '../auth/user-store.js';
import type { AuthConfig } from '../config/app-config.js';
import { UserEntity } from './entities.js';

export class PgUserStore implements UserStore {
  constructor(private readonly dataSource: DataSource) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ email: email.trim().toLowerCase() });
    return row ? { email: row.email, passwordHash: row.passwordHash, role: row.role } : null;
  }
}

/**
 * Makes the `users` table contain the seed admin from the environment: creates
 * it, or updates the password/role when `.env` changed. There is deliberately
 * no registration; this is the only way an account appears.
 */
export async function seedAdmin(dataSource: DataSource, auth: AuthConfig): Promise<void> {
  const logger = new Logger('Auth');
  const admin = await resolveSeedAdmin(auth);
  const repository = dataSource.getRepository(UserEntity);
  const existing = await repository.findOneBy({ email: admin.email });

  if (!existing) {
    await repository.insert({ email: admin.email, passwordHash: admin.passwordHash, role: 'admin' });
    logger.log(`Created seed admin ${admin.email}`);
    return;
  }
  // The plain password is re-hashed on every start (new salt); only write when it really changed.
  const samePassword = await bcrypt.compare(
    auth.adminPassword ?? '',
    existing.passwordHash,
  ).catch(() => false);
  const sameHash = auth.adminPasswordHash !== null && auth.adminPasswordHash === existing.passwordHash;
  if (existing.role === 'admin' && (samePassword || sameHash)) return;

  await repository.update({ id: existing.id }, { passwordHash: admin.passwordHash, role: 'admin' });
  logger.log(`Updated seed admin ${admin.email} from environment`);
}
