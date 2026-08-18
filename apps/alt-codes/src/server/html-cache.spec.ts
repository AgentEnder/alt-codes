import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withHtmlCache, type EdgeExecutionContext } from './html-cache';

const CACHED_AT_HEADER = 'x-alt-codes-cached-at';

class FakeCache {
  store = new Map<string, Response>();
  putCalls: string[] = [];

  async match(key: Request): Promise<Response | undefined> {
    const hit = this.store.get(key.url);
    return hit ? hit.clone() : undefined;
  }

  async put(key: Request, response: Response): Promise<void> {
    this.putCalls.push(key.url);
    this.store.set(key.url, response);
  }

  /** Seed an entry as though it had been cached `ageSeconds` ago. */
  seed(url: string, body: string, ageSeconds: number) {
    this.store.set(
      url,
      new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          [CACHED_AT_HEADER]: `${Date.now() - ageSeconds * 1000}`,
        },
      }),
    );
  }
}

let cache: FakeCache;
let renders: number;
let scheduled: Promise<unknown>[];

/** Stands in for the Worker's ExecutionContext, collecting background work. */
const ctx: EdgeExecutionContext = {
  waitUntil: (p) => {
    scheduled.push(p);
  },
};

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'text/html', ...init.headers },
  });
}

function render(body = '<html>rendered</html>', init?: ResponseInit) {
  return async () => {
    renders += 1;
    return html(body, init);
  };
}

function serve(url: string, init?: RequestInit, renderFn = render()) {
  return withHtmlCache(new Request(url, init), ctx, renderFn);
}

beforeEach(() => {
  cache = new FakeCache();
  renders = 0;
  scheduled = [];
  (globalThis as unknown as { caches: unknown }).caches = { default: cache };
});

afterEach(() => {
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('withHtmlCache', () => {
  it('caches a rendered HTML response', async () => {
    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(res.status).toBe(200);
    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual(['https://alt-codes.craigory.dev/symbol/00e9']);
  });

  it('still streams the rendered body to the visitor on a miss', async () => {
    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(await res.text()).toContain('rendered');
    expect(renders).toBe(1);
  });

  it('drops the query string from the cache key so client-side view state cannot fragment it', async () => {
    await serve('https://alt-codes.craigory.dev/?q=arrow');

    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual(['https://alt-codes.craigory.dev/']);
  });

  it('keys distinct paths separately', async () => {
    await serve('https://alt-codes.craigory.dev/symbol/00e9');
    await serve('https://alt-codes.craigory.dev/category/arrows');

    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual([
      'https://alt-codes.craigory.dev/symbol/00e9',
      'https://alt-codes.craigory.dev/category/arrows',
    ]);
  });

  it('serves a fresh entry without re-rendering', async () => {
    cache.seed('https://alt-codes.craigory.dev/symbol/00e9', '<html>cached</html>', 10);

    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(await res.text()).toContain('cached');
    expect(renders).toBe(0);
  });

  it('serves a stale entry immediately and re-renders behind it', async () => {
    cache.seed('https://alt-codes.craigory.dev/symbol/00e9', '<html>stale</html>', 3600);

    // The background render is held open, so returning at all proves the
    // visitor was never made to wait on it.
    let releaseRender!: () => void;
    const rendered = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });

    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9', undefined, async () => {
      renders += 1;
      await rendered;
      return html('<html>fresh</html>');
    });

    expect(await res.text()).toContain('stale');
    expect(await cache.store.get('https://alt-codes.craigory.dev/symbol/00e9')!.text()).toContain(
      'stale',
    );

    releaseRender();
    await Promise.all(scheduled);
    expect(renders).toBe(1);
    expect(await cache.store.get('https://alt-codes.craigory.dev/symbol/00e9')!.text()).toContain(
      'fresh',
    );
  });

  it('treats an entry with no freshness stamp as stale', async () => {
    cache.store.set(
      'https://alt-codes.craigory.dev/symbol/00e9',
      html('<html>unstamped</html>'),
    );

    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(await res.text()).toContain('unstamped');
    await Promise.all(scheduled);
    expect(renders).toBe(1);
  });

  it('stamps stored entries with a stale-while-revalidate Cache-Control', async () => {
    await serve('https://alt-codes.craigory.dev/symbol/00e9');

    await Promise.all(scheduled);
    const stored = cache.store.get('https://alt-codes.craigory.dev/symbol/00e9')!;
    expect(stored.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    );
    expect(stored.headers.get(CACHED_AT_HEADER)).toBeTruthy();
  });

  it('gives a miss and a hit the same Cache-Control, so it does not depend on arriving first', async () => {
    const miss = await serve('https://alt-codes.craigory.dev/symbol/00e9');
    await Promise.all(scheduled);
    const hit = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(hit.headers.get('Cache-Control')).toBe(miss.headers.get('Cache-Control'));
    expect(miss.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    );
  });

  it('leaves the render untouched when it is not cacheable', async () => {
    const res = await serve(
      'https://alt-codes.craigory.dev/symbol/nope',
      undefined,
      render('<html>missing</html>', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not cache non-200 responses', async () => {
    await serve(
      'https://alt-codes.craigory.dev/symbol/nope',
      undefined,
      render('<html>missing</html>', { status: 404 }),
    );

    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual([]);
  });

  it('does not cache non-HTML responses', async () => {
    await serve(
      'https://alt-codes.craigory.dev/index.pageContext.json',
      undefined,
      render('{}', { headers: { 'Content-Type': 'application/json' } }),
    );

    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual([]);
  });

  it('does not cache non-GET requests', async () => {
    await serve('https://alt-codes.craigory.dev/symbol/00e9', { method: 'POST' });

    await Promise.all(scheduled);
    expect(cache.putCalls).toEqual([]);
  });

  it('renders directly when there is no edge cache (dev, preview, workers.dev)', async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches;

    const res = await serve('https://alt-codes.craigory.dev/symbol/00e9');

    expect(await res.text()).toContain('rendered');
    expect(renders).toBe(1);
    expect(cache.putCalls).toEqual([]);
  });

  it('renders directly when there is no ExecutionContext to schedule the write on', async () => {
    const res = await withHtmlCache(
      new Request('https://alt-codes.craigory.dev/symbol/00e9'),
      undefined,
      render(),
    );

    expect(await res.text()).toContain('rendered');
    expect(cache.putCalls).toEqual([]);
  });
});
