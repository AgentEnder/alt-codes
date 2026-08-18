/**
 * The `/og/v<N>/<slug>.png` route: slug → Unicode entry → card → PNG, behind two cache tiers.
 *
 * This runs BEFORE Vike in `+server.ts`, not as a page. A card is not HTML, must not go
 * through the stale-while-revalidate HTML cache, and needs the request to fail loudly when the
 * font supply is unreachable — none of which a Vike route gives.
 *
 * The wasm modules arrive as an argument rather than being imported here. `+server.ts` is the
 * only file the Cloudflare bundler treats as the Worker entry, so that is where a `.wasm`
 * import becomes a compiled `WebAssembly.Module`; taking them as a parameter also keeps this
 * module runnable under plain Node in the test suite. render.ts already documents the same
 * contract for the same reason.
 */

import {
  CATEGORIES,
  type CharacterEntry,
  parseSymbolSlug,
  toSymbolSlug,
} from '../unicode-data';
import { OG_CARD_VERSION, parseOgCardPath } from '../og/card-url';
import { FontSourceUnavailableError } from '../og/font-source';
import { initResvg, initSatori, renderGlyphCard, type WasmInput } from '../og/render';
import { resolveEntry } from '../../pages/unicode-loader.server';
import type { EdgeExecutionContext } from './html-cache';
import { type OgCacheBucket, serveCachedPng } from './og-cache';

/** Satori's yoga layout engine and resvg's rasteriser, as the Worker's bundler compiled them. */
export interface OgWasm {
  yoga: WasmInput;
  resvg: WasmInput;
}

/** The Worker `env`, as far as this route is concerned. */
export interface OgEnv {
  /**
   * The R2 bucket behind the edge cache. Optional because it only exists where it has been
   * bound — `vike dev`, `vike preview` and the Node prod server have no bindings at all, and
   * a card still renders without it.
   */
  OG_CACHE?: OgCacheBucket;
}

/** Answers that must never be cached, because both can become right later. */
function uncacheable(status: number, body: string, extra?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Drop the body from a response to a HEAD, keeping every header a crawler will read. */
function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Handle a card request, or return null when the URL is not one.
 *
 * Null is the fall-through signal: `+server.ts` hands anything this declines to Vike, so a
 * `/og/…` path of a version we no longer serve reaches the app's own 404 page rather than
 * being answered here with a card of the current design under a URL promised to be immutable.
 */
export async function handleOgRequest(
  request: Request,
  env: OgEnv | undefined,
  ctx: EdgeExecutionContext | undefined,
  wasm: OgWasm,
): Promise<Response | null> {
  const slug = parseOgCardPath(new URL(request.url).pathname);
  if (slug === null) return null;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return uncacheable(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }

  const response = await answer(request, env, ctx, slug, wasm);
  // Stripping the body here rather than at each `return` covers the error answers too: a
  // crawler that probes with HEAD before fetching gets the same status and headers either way.
  return request.method === 'HEAD' ? withoutBody(response) : response;
}

async function answer(
  request: Request,
  env: OgEnv | undefined,
  ctx: EdgeExecutionContext | undefined,
  slug: string,
  wasm: OgWasm,
): Promise<Response> {
  // Shares `resolveEntry` with the symbol page so a card cannot exist for a URL
  // the page 404s, or vice versa — both used to 404 on all CJK and Hangul.
  const entry = resolveEntry(parseSymbolSlug(slug));
  // Not an error: an unassigned code point is simply not a glyph we have a card for. `no-store`
  // because a Unicode version bump can turn this into a real answer without a redeploy of the
  // thing that cached it.
  if (!entry) return uncacheable(404, `No glyph at ${slug}.`);

  // Key on the RESOLVED slug, not the requested one. `parseSymbolSlug` reads only the hex
  // prefix, so `/og/v1/2190-anything.png` resolves the same glyph as the canonical URL — and
  // without this, every spelling a stranger tries would mint its own R2 object.
  const objectKey = `v${OG_CARD_VERSION}/${toSymbolSlug(entry)}.png`;

  return serveCard(request, env, ctx, objectKey, entry, wasm);
}

async function serveCard(
  request: Request,
  env: OgEnv | undefined,
  ctx: EdgeExecutionContext | undefined,
  objectKey: string,
  entry: CharacterEntry,
  wasm: OgWasm,
): Promise<Response> {
  try {
    // No font cache of our own, deliberately. A card is rendered once per version and then
    // answered from R2 forever, so the font fetches are already amortised — and a Worker's
    // outbound `fetch` goes through Cloudflare's cache anyway, which honours the long
    // lifetimes Google Fonts and jsDelivr both send. Hand-rolling one would buy the first
    // render of a second card in the same isolate, at the cost of a bounded-memory problem.
    return await serveCachedPng(request, ctx, env?.OG_CACHE, objectKey, async () => {
      // Inside the render closure on purpose: a cache hit should not pay to compile wasm.
      // Both calls memoise per isolate, so this is a no-op after the first miss.
      await Promise.all([initSatori(wasm.yoga), initResvg(wasm.resvg)]);

      const { png } = await renderGlyphCard({
        codePoints: entry.codePoints,
        char: entry.char,
        name: entry.name,
        hex: entry.hex,
        altCode: entry.altCode,
        categoryName: CATEGORIES.find((c) => c.id === entry.categoryId)?.name ?? entry.categoryId,
      });
      return png;
    });
  } catch (err) {
    // The one fault worth translating. `font-source.ts` throws this only when it could not
    // find out whether a glyph is covered — never when it found out that it is not. Serving a
    // "no glyph available" card here would store that guess under a year-long immutable entry;
    // a retryable 503 costs one crawler visit instead.
    if (!(err instanceof FontSourceUnavailableError)) throw err;
    return uncacheable(503, 'Card fonts are temporarily unavailable.', { 'Retry-After': '60' });
  }
}
