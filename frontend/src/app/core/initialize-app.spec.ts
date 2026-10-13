import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { apiBaseInterceptor } from './api-base.interceptor';
import { Auth } from './auth';
import { initializeApp } from './initialize-app';
import { RuntimeConfig } from './runtime-config';

describe('initializeApp', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiBaseInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Starts the initializer and returns once config.json has been "fetched". */
  async function start(apiBaseUrl: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ apiBaseUrl }) })),
    );
    // Runs in an injection context exactly like provideAppInitializer does.
    const done = TestBed.runInInjectionContext(() => initializeApp());
    await new Promise((resolve) => setTimeout(resolve, 0));
    return done;
  }

  it('loads config.json and then restores the session from the configured API', async () => {
    const http = TestBed.inject(HttpTestingController);
    const done = start('https://api.example.com');
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The session check goes to the API origin named in config.json.
    const request = http.expectOne('https://api.example.com/api/auth/me');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user: { email: 'admin@example.com', role: 'admin' } });
    await done;

    expect(TestBed.inject(RuntimeConfig).apiBase).toBe('https://api.example.com');
    expect(TestBed.inject(Auth).user()).toEqual({ email: 'admin@example.com', role: 'admin' });
  });

  it('starts signed out when the API says there is no session', async () => {
    const http = TestBed.inject(HttpTestingController);
    const done = start('');
    await new Promise((resolve) => setTimeout(resolve, 5));

    http
      .expectOne('/api/auth/me')
      .flush({ message: 'Authentication required' }, { status: 401, statusText: 'Unauthorized' });
    await done;

    expect(TestBed.inject(Auth).user()).toBeNull();
  });
});
