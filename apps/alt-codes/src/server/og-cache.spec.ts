/**
 * The two tiers under a card, and — more importantly — the rules about what must NOT be
 * written. A card is served `immutable` for a year, so a wrong byte here outlives the deploy
 * that produced it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OG_CARD_CACHE_CONTROL, type OgCacheBucket, serveCachedPng } from './og-cache';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const KEY = 'v1/2190-leftwards-arrow.png';
const URL_ = 'https://alt-codes.craigory.dev/og/v1/2190-leftwards-arrow.png';

/** A `Cache` stand-in keyed by URL, which is all `caches.default` is from here. */
function fakeCache() {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: vi.fn(async (req: Request) => entries.get(req.url)?.clone()),
    put: vi.fn(async (req: Request, res: Response) => {
      entries.set(req.url, res);
    }),
  };
}

function fakeBucket(initial?: Uint8Array): OgCacheBucket & { stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>();
  if (initial) stored.set(KEY, initial);
  return {
    stored,
    get: vi.fn(async (key: string) => {
      const hit = stored.get(key);
      return hit
        ? { arrayBuffer: async () => hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength) as ArrayBuffer }
        : null;
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array) => {
      stored.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    }),
  };
}

/** Collects `waitUntil` work so a test can await the writes the response did not wait for. */
function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
}

let cache: ReturnType<typeof fakeCache>;

beforeEach(() => {
  cache = fakeCache();
  (globalThis as { caches?: unknown }).caches = { default: cache };
});

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

async function bodyOf(res: Response): Promise<number[]> {
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}

describe('serveCachedPng', () => {
  it('serves an edge hit without rendering or reading R2', async () => {
    cache.entries.set(URL_, new Response(PNG));
    const bucket = fakeBucket();
    const render = vi.fn();

    const res = await serveCachedPng(new Request(URL_), fakeCtx(), bucket, KEY, render);

    expect(await bodyOf(res)).toEqual([...PNG]);
    expect(render).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it('serves an R2 hit and promotes it back to the edge', async () => {
    // The whole reason R2 sits behind the edge cache: an eviction should cost a byte range
    // read, not four network font fetches and a rasterise.
    const bucket = fakeBucket(PNG);
    const render = vi.fn();
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, bucket, KEY, render);

    expect(await bodyOf(res)).toEqual([...PNG]);
    expect(render).not.toHaveBeenCalled();
    await Promise.all(ctx.pending);
    expect(cache.put).toHaveBeenCalled();
  });

  it('renders on a full miss and writes both tiers', async () => {
    const bucket = fakeBucket();
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, bucket, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(OG_CARD_CACHE_CONTROL);

    await Promise.all(ctx.pending);
    expect(bucket.stored.get(KEY)).toEqual(PNG);
    expect(cache.entries.has(URL_)).toBe(true);
  });

  it('keys the edge cache on the path alone', async () => {
    // A scraper appending `?utm_source=…` must not bypass the cache: a miss here costs a
    // full render, so a query string would be a cheap way to make the Worker do real work.
    cache.entries.set(URL_, new Response(PNG));
    const render = vi.fn();

    const res = await serveCachedPng(
      new Request(`${URL_}?utm_source=slack`),
      fakeCtx(),
      fakeBucket(),
      KEY,
      render,
    );

    expect(await bodyOf(res)).toEqual([...PNG]);
    expect(render).not.toHaveBeenCalled();
  });

  it('renders normally with no R2 binding, which is every non-deployed environment', async () => {
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, undefined, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    await Promise.all(ctx.pending);
    expect(cache.entries.has(URL_)).toBe(true);
  });

  it('renders normally with no execution context, and writes nothing', async () => {
    // Without `waitUntil` there is nowhere to finish a write after responding, and writing
    // inline would put both stores on the visitor's critical path.
    const bucket = fakeBucket();

    const res = await serveCachedPng(new Request(URL_), undefined, bucket, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('renders when R2 cannot be read, rather than failing the request', async () => {
    // Falling back to a render is safe here in a way it is NOT for a font fault: rendering
    // produces the CORRECT card. A font fault would produce a plausible but wrong one, which
    // is why font-source.ts throws instead of degrading.
    const bucket = fakeBucket();
    bucket.get = vi.fn(async () => {
      throw new Error('R2 unavailable');
    });
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, bucket, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    await Promise.all(ctx.pending);
  });

  it('does not fail a served response because a background write failed', async () => {
    const bucket = fakeBucket();
    bucket.put = vi.fn(async () => {
      throw new Error('R2 write failed');
    });
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, bucket, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    // An unhandled rejection inside `waitUntil` is an error the runtime reports; the write is
    // best-effort, so it has to settle rather than reject.
    await expect(Promise.all(ctx.pending)).resolves.toBeDefined();
  });

  it('lets a render failure propagate, so nothing is stored', async () => {
    const bucket = fakeBucket();
    const ctx = fakeCtx();

    await expect(
      serveCachedPng(new Request(URL_), ctx, bucket, KEY, async () => {
        throw new Error('fonts unavailable');
      }),
    ).rejects.toThrow('fonts unavailable');

    await Promise.all(ctx.pending);
    expect(bucket.stored.size).toBe(0);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('renders without an edge cache at all, which is dev and preview', async () => {
    delete (globalThis as { caches?: unknown }).caches;
    const bucket = fakeBucket();
    const ctx = fakeCtx();

    const res = await serveCachedPng(new Request(URL_), ctx, bucket, KEY, async () => PNG);

    expect(await bodyOf(res)).toEqual([...PNG]);
    // R2 is still worth writing off the edge — it is the tier that survives a deploy.
    await Promise.all(ctx.pending);
    expect(bucket.stored.get(KEY)).toEqual(PNG);
  });
});
