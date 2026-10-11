import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth';

/** Auth endpoints handle their own 401s (wrong password, no session yet). */
const SELF_HANDLED = ['/api/auth/login', '/api/auth/logout', '/api/auth/me'];

/**
 * Any other API call that comes back 401 means the session ended (expired,
 * server restarted with a new secret): drop local state and show the login page.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        request.url.startsWith('/api/') &&
        !SELF_HANDLED.some((url) => request.url.startsWith(url))
      ) {
        auth.user.set(null);
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
