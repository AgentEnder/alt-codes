import type { Server } from 'vike/types';
import vike from 'vike/fetch';
import { withHtmlCache, type EdgeExecutionContext } from './src/server/html-cache';
import { handleOgRequest, type OgEnv } from './src/server/og-handler';

// The two wasm modules the card renderer needs, imported HERE rather than in the renderer.
//
// This file is the Worker entry, which is what makes these imports compile to bound
// `WebAssembly.Module` values — a Worker cannot fetch and instantiate wasm at runtime, and
// `satori`'s default entry tries to. Keeping the imports at the entry is also what lets
// og-handler.ts and render.ts run under plain Node in the test suite: they take the modules as
// arguments and never name a `.wasm` file.
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import yogaWasm from 'satori/yoga.wasm';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const wasm = { yoga: yogaWasm, resvg: resvgWasm };

/**
 * Vike's SSR handler.
 *
 * Its published signature is universal-middleware's `(request, context, runtime)`,
 * but on Cloudflare it is invoked with the Worker's `(request, env, ctx)` — that
 * is exactly what Vike does itself for an app with no `+server.ts`, where it
 * registers `vike/fetch` as the entry and the generated `virtual:ud:catch-all`
 * forwards the raw Worker arguments to it. So forward them unchanged.
 */
const renderPage = vike.fetch as unknown as (
  request: Request,
  env: unknown,
  ctx: EdgeExecutionContext | undefined,
) => Promise<Response>;

/**
 * The Worker's entry.
 *
 * `fetch` is REQUIRED, not decorative: when a `+server.ts` exists, Vike makes it
 * the registered entry for every route, and the generated catch-all asserts a
 * `fetch()` on this default export before dispatching. An entry exporting only
 * `prod` throws on every request.
 *
 * Social cards are dispatched BEFORE Vike and return null when the URL is not one, so every
 * other path routes exactly as it did. They cannot be a Vike page: a card is a PNG, it must
 * not go through the HTML cache's stale-while-revalidate, and it has to be able to fail the
 * request outright when the font source is unreachable — see og-handler.ts.
 *
 * There is still no Hono app here. This app is read-only and anonymous — no API
 * routes, no auth, no cron — so it needs neither a router nor a `scheduled`
 * export, and both caches are plain wrappers rather than middleware.
 *
 * `env` and `ctx` are optional because the Worker runtime supplies them but
 * `vike preview` and the Node prod server do not.
 */
export default {
  fetch: async (request: Request, env?: OgEnv, ctx?: EdgeExecutionContext) => {
    const card = await handleOgRequest(request, env, ctx, wasm);
    if (card) return card;
    return withHtmlCache(request, ctx, () => renderPage(request, env, ctx));
  },
  prod: { port },
} satisfies Server;
