import type { GlobalContext } from 'vike/types';
import { loadUnicodeData } from './unicode-loader.server';

/**
 * Expose the Unicode table on the global context WITHOUT building it.
 *
 * Vike runs this when the global context is created, which on a Worker is during
 * the cold start. Calling `loadUnicodeData()` here made every cold start
 * materialize the whole table — ~3,900 curated code points plus every code point
 * added in the latest Unicode version, and the name/alias/emoji maps over them —
 * before the isolate could answer anything, including requests that never touch
 * it (assets that miss the asset layer, HEAD probes, a cached HTML hit).
 *
 * A lazy getter defers that to the first page that reads `unicodeData`, and the
 * loader's own module-level memo makes it once per isolate rather than once per
 * request. Nothing at the call sites changes: they still read a plain property.
 */
export function onCreateGlobalContext(globalContext: GlobalContext): void {
  Object.defineProperty(globalContext, 'unicodeData', {
    get: loadUnicodeData,
    enumerable: true,
    configurable: true,
  });
}
