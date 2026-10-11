import { inject } from '@angular/core';
import { Auth } from './auth';
import { RuntimeConfig } from './runtime-config';

/**
 * Runs before the first route is resolved: read config.json (where the API
 * lives), then ask the API whether the session cookie is still valid.
 *
 * Both services are injected up front: `inject()` only works synchronously,
 * so calling it after an `await` throws NG0203.
 */
export async function initializeApp(): Promise<void> {
  const config = inject(RuntimeConfig);
  const auth = inject(Auth);
  await config.load();
  await auth.restore();
}
