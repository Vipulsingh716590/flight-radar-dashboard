import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { RuntimeConfig } from './runtime-config';

/**
 * Points `/api/...` calls at the configured API origin and sends the session
 * cookie with them. Does nothing in the same-origin setup, so local
 * development (with the dev-server proxy) is unchanged.
 */
export const apiBaseInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(RuntimeConfig);
  if (!config.crossOrigin || !request.url.startsWith('/api/')) return next(request);
  return next(request.clone({ url: config.url(request.url), withCredentials: true }));
};
