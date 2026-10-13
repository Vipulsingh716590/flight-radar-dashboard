import { Injectable, signal } from '@angular/core';

/** The non-standard install prompt event Chromium browsers fire. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Install app" support. Chromium browsers hand over an install prompt that
 * must be kept until the user taps our button; Safari on iOS has no such
 * event, so there we only explain the Share -> Add to Home Screen route.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstall {
  readonly canInstall = signal(false);
  /** iOS Safari, not yet installed: show the manual instructions instead of a button. */
  readonly showIosHint = signal(false);

  private deferred: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const standalone =
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canInstall.set(false);
      this.showIosHint.set(false);
    });
    this.showIosHint.set(/iphone|ipad|ipod/i.test(navigator.userAgent));
  }

  async install(): Promise<void> {
    const prompt = this.deferred;
    if (!prompt) return;
    this.deferred = null;
    this.canInstall.set(false);
    await prompt.prompt();
    await prompt.userChoice;
  }
}
