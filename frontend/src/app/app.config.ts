import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { apiBaseInterceptor } from './core/api-base.interceptor';
import { authInterceptor } from './core/auth.interceptor';
import { initializeApp } from './core/initialize-app';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Order matters: the auth interceptor must see the original /api/... URL.
    provideHttpClient(withInterceptors([authInterceptor, apiBaseInterceptor])),
    // Read config.json (where the API lives), then check the session cookie, both
    // before the first route guard runs.
    provideAppInitializer(initializeApp),
  ],
};
