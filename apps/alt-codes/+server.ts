import type { Server } from 'vike/types';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * The Worker's entry. Vike supplies the fetch handler; there is nothing to add
 * around it — this app is read-only and anonymous, with no API routes, no auth
 * and no cron, so it needs neither a Hono app nor a `scheduled` export.
 */
export default {
  prod: { port },
} satisfies Server;
