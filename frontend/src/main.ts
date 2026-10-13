import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

// Offline app shell (see public/sw.js). Not in dev mode: a cached bundle would
// hide the changes the dev server is rebuilding.
if (!isDevMode() && 'serviceWorker' in navigator) {
  const register = () =>
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('[pwa]', error));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
