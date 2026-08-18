/**
 * Stale-while-revalidate cache for server-rendered HTML, backed by `caches.default`.
 *
 * Ported from npm-burst's `src/server/html-cache.ts`, minus its tripwires.
 *
 * ⚠️ WHY THE TRIPWIRES ARE GONE, AND WHEN TO PUT THEM BACK
 *
 * npm-burst guards this cache with two checks: it bypasses the cache for any
 * request carrying an `Authorization` header, and refuses to store any response
 * carrying `Set-Cookie`. Both exist because npm-burst has signed-in users, and a
 * *shared* cache that stored one user's HTML would hand it to everyone.
 *
 * alt-codes has no auth and no per-user state of any kind: every route is a pure
 * function of the URL over a static Unicode table, so every render is already
 * identical for every visitor. The hazard class those guards defend against does
 * not exist here, and carrying them would be cargo cult.
 *
 * If authentication, personalisation, or anything else that varies a render by
 * visitor is EVER added to this app, reinstate both guards in the same commit —
 * otherwise this file silently becomes a data-leak vector.
 *
 * Note: `caches.default` is a no-op outside Cloudflare's edge — including
 * workers.dev subdomains, `wrangler dev` and `vike preview`. Nothing below is
 * exercised until the custom domain is bound (#795); off the edge every request
 * simply renders.
 */

/** How long a cached render is served without re-rendering. */
const FRESH_SECONDS = 5 * 60;
/** How long a stale render may still be served while re-rendering behind it. */
const STALE_SECONDS = 24 * 60 * 60;

/** Read on a cache hit to age it — `cache.match` does not report insertion time. */
const CACHED_AT_HEADER = 'x-alt-codes-cached-at';

/**
 * The slice of Cloudflare's `ExecutionContext` this module needs.
 *
 * Declared structurally rather than pulled from `@cloudflare/workers-types`,
 * which redefines `Request`/`Response`/`Cache` globally and would collide with
 * the DOM lib the client code compiles against.
 */
export interface EdgeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** `caches.default` is Cloudflare's extension to the standard `CacheStorage`. */
interface CacheStorageWithDefault {
  default?: Cache;
}

function getEdgeCache(): Cache | null {
  const caches = (globalThis as { caches?: CacheStorageWithDefault }).caches;
  return caches?.default ?? null;
}

/**
 * Cache key = the path, with the query string dropped.
 *
 * The only query parameter this app reads is `?q=` on the home page, and it is
 * read from `window.location` in an effect — it never reaches the server render.
 * Keying on it would mint a fresh entry per keystroke for identical HTML.
 */
function buildCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

function ageSeconds(response: Response): number {
  const cachedAt = response.headers.get(CACHED_AT_HEADER);
  if (!cachedAt) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(cachedAt, 10);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return (Date.now() - parsed) / 1000;
}

/** Stamp freshness metadata so a `cache.match` result can be aged on read. */
function withCacheMetadata(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, `${Date.now()}`);
  headers.set(
    'Cache-Control',
    `public, max-age=${FRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isCacheable(response: Response): boolean {
  if (response.status !== 200) return false;
  const contentType = response.headers.get('Content-Type') ?? '';
  return contentType.includes('text/html');
}

async function store(key: Request, cache: Cache, response: Response): Promise<void> {
  if (!isCacheable(response)) return;
  await cache.put(key, withCacheMetadata(response));
}

/**
 * Wrap an SSR render in the edge cache.
 *
 * `render` is called at most once per invocation: on a miss to produce the
 * response, or behind a stale hit to refresh it.
 *
 * Unlike npm-burst — where this is Hono middleware and `next()` can only run
 * once per request — revalidation here just calls `render` again directly. No
 * self-subrequest, so no loopback to reason about and no marker header needed to
 * stop it recursing.
 */
export async function withHtmlCache(
  request: Request,
  ctx: EdgeExecutionContext | undefined,
  render: () => Promise<Response>,
): Promise<Response> {
  const cache = getEdgeCache();

  // No `waitUntil` means no way to finish a cache write after responding, and
  // writing inline would put the store on the visitor's critical path.
  if (!cache || !ctx || request.method !== 'GET') return render();

  const key = buildCacheKey(request);
  const hit = await cache.match(key);

  if (hit) {
    if (ageSeconds(hit) <= FRESH_SECONDS) return hit;
    // Stale: answer immediately, refresh behind the response.
    ctx.waitUntil(render().then((fresh) => store(key, cache, fresh)));
    return hit;
  }

  const response = await render();
  if (!isCacheable(response)) return response;

  // Stamp the copy we RETURN as well as the copy we store, which npm-burst does
  // not. Vike answers `no-store, max-age=0`; stamping only the stored copy would
  // mean a visitor's browser caching behaviour depended on whether they happened
  // to be the one who missed, since every later visitor is served the stamped
  // entry. (Rewriting the header is also what makes the write legal at all —
  // Cloudflare's `cache.put` rejects a response it has been told not to store.)
  const stamped = withCacheMetadata(response);
  ctx.waitUntil(cache.put(key, stamped.clone()));
  return stamped;
}
