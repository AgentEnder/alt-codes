/**
 * Prepend the Vite base URL to an app-relative path.
 *
 * The base is configured in vite.config.ts and is '/' now that the app is served from
 * its own hostname. All internal <a href> values still go through this so the base
 * stays a single knob rather than something baked into every link.
 *
 * Usage:  href={withBase('/symbol/2190-leftwards-arrow')}
 */
export function withBase(path: string): string {
  // import.meta.env.BASE_URL always ends with '/'; path always starts with '/'
  return import.meta.env.BASE_URL.replace(/\/$/, '') + path;
}
