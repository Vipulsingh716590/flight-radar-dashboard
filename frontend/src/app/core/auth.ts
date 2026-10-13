import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export type Role = 'admin' | 'viewer';

export interface SessionUser {
  email: string;
  role: Role;
}

/** Thrown by {@link Auth.login} with a message that is safe to show to the user. */
export class LoginError extends Error {}

/**
 * Session state. The session itself is an httpOnly cookie the browser sends
 * automatically, so this only mirrors "who am I" for the UI and route guard.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly user = signal<SessionUser | null>(null);
  /** True when the server runs with sign-in switched off (local development). */
  readonly authDisabled = signal(false);

  /** Asks the server whether the cookie is still a valid session. */
  async restore(): Promise<void> {
    try {
      const body = await firstValueFrom(
        this.http.get<{ user: SessionUser; authDisabled?: boolean }>('/api/auth/me'),
      );
      this.user.set(body.user);
      this.authDisabled.set(body.authDisabled === true);
    } catch {
      this.user.set(null);
      this.authDisabled.set(false);
    }
  }

  async login(email: string, password: string): Promise<void> {
    try {
      const { user } = await firstValueFrom(
        this.http.post<{ user: SessionUser }>('/api/auth/login', { email, password }),
      );
      this.user.set(user);
    } catch (error) {
      throw new LoginError(loginMessage(error));
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.user.set(null);
      await this.router.navigate(['/login']);
    }
  }

  /** Re-checks the session (e.g. after the live stream dropped) and leaves if it expired. */
  async verifySession(): Promise<void> {
    await this.restore();
    if (!this.user()) await this.router.navigate(['/login']);
  }
}

function loginMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Invalid email or password.';
    if (error.status === 429) {
      const message = (error.error as { message?: unknown } | null)?.message;
      return typeof message === 'string' ? message : 'Too many failed attempts. Try again later.';
    }
    if (error.status === 400) return 'Enter your email and password.';
    if (error.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Sign-in failed. Please try again.';
}
