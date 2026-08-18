import { useData } from 'vike-react/useData';
import type { SymbolData } from './+data.server';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SITE_ORIGIN,
  absoluteOgCardUrl,
  ogCardAltText,
} from '../../../src/og/card-url';
import { toSymbolSlug } from '../../../src/unicode-data';

export function Head() {
  const { entry } = useData<SymbolData>();
  const label = entry.name || entry.hex;
  const title = `${entry.char} ${label} — Glyph Index`;
  const description = `Unicode ${entry.hex} — ${label}. UTF-8, HTML entity, alt code, and related characters.`;
  const pageUrl = `${SITE_ORIGIN}/symbol/${toSymbolSlug(entry)}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />

      {/*
        The per-symbol social card, rendered on demand by the Worker at the URL below rather
        than prerendered into the site. Generating all ~3,752 of them at build time came to
        ~589 MB of git blobs and ~62 minutes of Playwright per deploy; see src/server/og-handler.ts.

        Absolute and canonical-host, not request-relative: og:image is not resolved against the
        page URL by every consumer, and the card must be advertised under the canonical host
        however the page itself was reached. The dimensions let a scraper reserve the space
        before it has the bytes.
      */}
      <meta property="og:image" content={absoluteOgCardUrl(entry)} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content={String(CARD_WIDTH)} />
      <meta property="og:image:height" content={String(CARD_HEIGHT)} />
      <meta property="og:image:alt" content={ogCardAltText(entry)} />

      {/* Without these a scraper guesses the preview's text from the document, which on a
          page this dense is a coin toss. og:url is the link the preview resolves to. */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={pageUrl} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />

      {/* The glyph is the subject and it is drawn at 240px, so the large variant is the only
          one worth serving — the summary card would shrink it to a thumbnail. */}
      <meta name="twitter:card" content="summary_large_image" />

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet"
      />
    </>
  );
}
