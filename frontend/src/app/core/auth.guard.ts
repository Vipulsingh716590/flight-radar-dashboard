import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

/** Every route except /login needs a session; anonymous users are sent to /login. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.user() ? true : inject(Router).createUrlTree(['/login']);
};

/** Keeps signed-in users away from the login page. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.user() ? inject(Router).createUrlTree(['/']) : true;
};
