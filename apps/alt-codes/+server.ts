import type { Server } from 'vike/types';
import vike from 'vike/fetch';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
  ctx: unknown,
) => Promise<Response>;

/**
 * The Worker's entry.
 *
 * `fetch` is REQUIRED, not decorative: when a `+server.ts` exists, Vike makes it
 * the registered entry for every route, and the generated catch-all asserts a
 * `fetch()` on this default export before dispatching. An entry exporting only
 * `prod` throws on every request.
 *
 * There is no Hono app here. This app is read-only and anonymous — no API
 * routes, no auth, no cron — so it needs neither a router nor a `scheduled`
 * export.
 *
 * `env` and `ctx` are optional because the Worker runtime supplies them but
 * `vike preview` and the Node prod server do not.
 */
export default {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => renderPage(request, env, ctx),
  prod: { port },
} satisfies Server;
