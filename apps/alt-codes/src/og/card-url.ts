/**
 * Where a symbol's social card lives, and how to get back from that URL to the symbol.
 *
 * Both directions belong in one file: `pages/symbol/…/+Head.tsx` builds the URL and
 * `src/server/og-handler.ts` takes it apart, and a mismatch between them is invisible until a
 * crawler fetches a 404 that no visitor ever sees.
 *
 * Pure on purpose. `+Head.tsx` renders on the client too, so nothing here may reach for the
 * Unicode table, satori, or a Worker global.
 */

import { toSymbolSlug } from '../unicode-data';

/**
 * The card design's version, and the reason it is in the PATH rather than a query string.
 *
 * Cards are served `immutable` for a year, so a redesign cannot invalidate the ones already
 * referenced from the web — a shared cache has been told it never needs to ask again. Bumping
 * this mints an entirely new set of URLs instead, which every consumer treats as new images.
 * The old ones keep answering from cache until they age out, which is the correct behaviour:
 * a link posted last month should keep resolving to a picture.
 *
 * Bump it whenever the rendered output changes — card.tsx, the font candidate lists, or the
 * pinned Twemoji tag. Leaving it alone means live cards silently disagree with the code.
 */
export const OG_CARD_VERSION = 1;

/**
 * The card's pixel dimensions.
 *
 * Here rather than in card.tsx because they are part of the URL's public contract: the page
 * advertises them as `og:image:width` / `og:image:height` so a scraper can reserve the space
 * before the bytes arrive. Keeping them in the card component would mean `+Head.tsx` importing
 * the whole Satori layout — and shipping it to every browser — to read two numbers.
 *
 * 1200x630 is the 1.91:1 that Facebook, Twitter/X, Slack and LinkedIn all specify.
 */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * The canonical host, which is deliberately NOT derived from the incoming request.
 *
 * The Worker also answers on `alt-codes.craigorycoppola.workers.dev`, and the HTML cache keys
 * on path alone — so a render triggered through one hostname is served on the other. Deriving
 * the origin from `Host` would let a workers.dev URL be cached into a card tag served on the
 * custom domain. A constant is both immune to that and the right answer anyway: a crawler
 * should be pointed at the canonical host regardless of how it reached the page.
 *
 * Resolves once the domain is bound in #795; until then the tags point somewhere real but
 * not yet live, which is harmless because nothing links to this app under that name yet.
 */
export const SITE_ORIGIN = 'https://alt-codes.craigory.dev';

/**
 * The slug alphabet, as produced by `toSymbolSlug`: a `_`-joined lowercase hex prefix, then
 * optionally `-` and the lowercased name with everything outside [a-z0-9-] stripped.
 *
 * Matched strictly rather than loosely. The slug becomes an R2 object key and a cache key, so
 * anything accepted here is something a stranger can make us store — and `..`, an escape, and
 * a differently-cased spelling of the same glyph would each mint their own year-long entry.
 */
const CARD_PATH_PATTERN = new RegExp(`^/og/v${OG_CARD_VERSION}/([0-9a-f]+(?:_[0-9a-f]+)*(?:-[a-z0-9-]*)?)\\.png$`);

/** The path a symbol's card is served from, e.g. `/og/v1/2190-leftwards-arrow.png`. */
export function ogCardPath(entry: Parameters<typeof toSymbolSlug>[0]): string {
  return `/og/v${OG_CARD_VERSION}/${toSymbolSlug(entry)}.png`;
}

/** The same path against the canonical host, which is what `og:image` has to carry. */
export function absoluteOgCardUrl(entry: Parameters<typeof toSymbolSlug>[0]): string {
  return SITE_ORIGIN + ogCardPath(entry);
}

/**
 * The symbol slug a card path names, or null when the path is not a card of THIS version.
 *
 * Null is the signal to fall through to the app's own router, so it has to cover an older or
 * newer version too: those URLs are not ours to render, and answering them from the current
 * design would serve a redesigned card under a URL promised to be immutable.
 */
export function parseOgCardPath(pathname: string): string | null {
  return CARD_PATH_PATTERN.exec(pathname)?.[1] ?? null;
}

/**
 * `og:image:alt` — what the card shows, for a reader who is given the tag but not the picture.
 *
 * It describes the CARD, not the character: the card's subject is the glyph drawn large, and a
 * screen-reader user has the page's own text for everything else.
 */
export function ogCardAltText(entry: { name: string; hex: string }): string {
  return entry.name
    ? `${entry.name} (${entry.hex}) shown at display size`
    : `${entry.hex} shown at display size`;
}
