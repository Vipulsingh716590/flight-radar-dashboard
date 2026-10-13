import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { apiBaseInterceptor } from './api-base.interceptor';
import { normaliseBase, RuntimeConfig } from './runtime-config';

describe('normaliseBase', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['  https://api.example.com/api/v1  ', 'https://api.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['', ''],
    ['   ', ''],
    ['not a url', ''],
    ['javascript:alert(1)', ''],
    ['ftp://example.com', ''],
    [null, ''],
    [42, ''],
  ])('%j -> %j', (input, expected) => {
    expect(normaliseBase(input)).toBe(expected);
  });
});

describe('RuntimeConfig.load', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (impl: () => Promise<Partial<Response>>) => vi.stubGlobal('fetch', vi.fn(impl));

  it('reads apiBaseUrl from config.json', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ apiBaseUrl: 'https://api.example.com/' }),
    }));
    const config = TestBed.inject(RuntimeConfig);
    await config.load();
    expect(config.apiBase).toBe('https://api.example.com');
    expect(config.crossOrigin).toBe(true);
    expect(config.url('/api/stream')).toBe('https://api.example.com/api/stream');
  });

  it('stays same-origin when the file is missing, broken or unreachable', async () => {
    for (const impl of [
      async () => ({ ok: false }),
      async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      }),
      async () => {
        throw new Error('offline');
      },
    ]) {
      stubFetch(impl);
      TestBed.resetTestingModule();
      const config = TestBed.inject(RuntimeConfig);
      await config.load();
      expect(config.crossOrigin).toBe(false);
      expect(config.url('/api/stream')).toBe('/api/stream');
    }
  });
});

describe('apiBaseInterceptor', () => {
  function setup(base: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiBaseInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const config = TestBed.inject(RuntimeConfig);
    (config as unknown as { base: string }).base = base;
    return { http: TestBed.inject(HttpClient), controller: TestBed.inject(HttpTestingController) };
  }

  it('leaves requests alone when the API is on the same origin', () => {
    const { http, controller } = setup('');
    http.get('/api/stats/summary').subscribe();
    const request = controller.expectOne('/api/stats/summary');
    expect(request.request.withCredentials).toBe(false);
  });

  it('sends /api calls to the API origin with credentials', () => {
    const { http, controller } = setup('https://api.example.com');
    http.get('/api/stats/summary').subscribe();
    const request = controller.expectOne('https://api.example.com/api/stats/summary');
    expect(request.request.withCredentials).toBe(true);
  });

  it('does not rewrite non-API requests such as config.json', () => {
    const { http, controller } = setup('https://api.example.com');
    http.get('/assets/something.json').subscribe();
    const request = controller.expectOne('/assets/something.json');
    expect(request.request.withCredentials).toBe(false);
  });
});
