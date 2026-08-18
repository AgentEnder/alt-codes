/**
 * Two cache tiers under a social card: `caches.default` at the edge, R2 behind it.
 *
 * Rendering a card is expensive in a way an HTML render is not — up to four third-party
 * network fetches for font subsets and a wasm rasterise, measured at ~300 ms to 2.4 s cold in
 * the #792 spike. The edge cache alone would make that cost recur on every eviction and in
 * every colo that has not seen the card, so R2 sits behind it as the tier that survives both,
 * and a deploy. An edge miss then costs one object read rather than a regeneration.
 *
 * Separate from `html-cache.ts` deliberately: that one is stale-while-revalidate over content
 * that changes when the code does, while a card at a versioned URL is immutable by
 * construction. Merging them would mean one of the two behaving as a compromise.
 *
 * As with the HTML cache, `caches.default` is a no-op off Cloudflare's edge — including
 * workers.dev, `wrangler dev` and `vike preview`. R2 is not: a binding works wherever it is
 * configured, so the lower tier is exercised well before the domain is bound.
 */

import type { EdgeExecutionContext } from './html-cache';

/**
 * A year, `immutable`.
 *
 * Honest only because the version is in the path: `immutable` tells a shared cache it never
 * needs to revalidate, so a card's bytes can never change under a given URL. A redesign bumps
 * `OG_CARD_VERSION` and mints new URLs instead of trying to invalidate these. See card-url.ts.
 */
export const OG_CARD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** What we read back out of R2. Narrower than `R2ObjectBody`, which is all this needs. */
export interface OgCacheObject {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The slice of `R2Bucket` this module uses.
 *
 * Declared structurally rather than imported from `@cloudflare/workers-types`, for the same
 * reason `html-cache.ts` declares its own `ExecutionContext`: those types redefine `Request`,
 * `Response` and `Cache` globally and collide with the DOM lib the client code compiles
 * against. A real `R2Bucket` satisfies this shape.
 */
export interface OgCacheBucket {
  get(key: string): Promise<OgCacheObject | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
}

function getEdgeCache(): Cache | null {
  const caches = (globalThis as { caches?: { default?: Cache } }).caches;
  return caches?.default ?? null;
}

/**
 * Edge cache key = the path, with the query string dropped.
 *
 * Nothing about a card varies by query parameter, and a miss costs a full render — so keying
 * on the search string would let any scraper appending `?utm_source=…` make the Worker do the
 * expensive thing again for bytes it already has.
 */
function buildCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

function pngResponse(body: ArrayBuffer | Uint8Array): Response {
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': OG_CARD_CACHE_CONTROL,
    },
  });
}

/**
 * Both tiers are best-effort: a card that was served correctly must not be retroactively
 * turned into an error because the copy we were filing away did not land. An unhandled
 * rejection inside `waitUntil` is also an error the runtime reports, so it has to be caught
 * here rather than left to settle.
 */
function bestEffort(work: Promise<unknown>): Promise<void> {
  return work.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Serve `objectKey`'s card, rendering it only if neither tier has it.
 *
 * `render` is called at most once, and only on a full miss. It must THROW rather than return
 * a placeholder when it cannot produce the real card — anything it returns is stored under an
 * immutable year-long entry, so a degraded card here becomes a permanent one. See
 * `font-source.ts`, which is built around exactly that distinction.
 */
export async function serveCachedPng(
  request: Request,
  ctx: EdgeExecutionContext | undefined,
  bucket: OgCacheBucket | undefined,
  objectKey: string,
  render: () => Promise<Uint8Array>,
): Promise<Response> {
  const cache = getEdgeCache();
  const key = buildCacheKey(request);

  const hit = await cache?.match(key);
  if (hit) return hit;

  if (bucket) {
    // A read fault falls through to rendering rather than failing the request, which is safe
    // in a way the font path's faults are not: re-rendering produces the CORRECT card, so the
    // worst case is latency. A font fault would produce a plausible but wrong one.
    const stored = await bucket.get(objectKey).catch(() => null);
    if (stored) {
      const bytes = await stored.arrayBuffer();
      const response = pngResponse(bytes);
      // Promote back to the edge so the next request in this colo skips R2 too.
      if (ctx && cache) ctx.waitUntil(bestEffort(cache.put(key, response.clone())));
      return response;
    }
  }

  const png = await render();
  const response = pngResponse(png);

  // No `waitUntil` means no way to finish a write after responding, and writing inline would
  // put both stores on the visitor's critical path.
  if (ctx) {
    if (cache) ctx.waitUntil(bestEffort(cache.put(key, response.clone())));
    if (bucket) {
      ctx.waitUntil(
        bestEffort(
          // The metadata only matters to something reading the bucket directly — every
          // visitor is served through this Worker — but a bucket that describes its own
          // contents is worth the one line.
          bucket.put(objectKey, png, {
            httpMetadata: { contentType: 'image/png', cacheControl: OG_CARD_CACHE_CONTROL },
          }),
        ),
      );
    }
  }

  return response;
}
