/**
 * The card URL is the contract between the page and the Worker: `+Head.tsx` builds it,
 * `og-handler.ts` takes it apart again. Both live here so they cannot drift, and so the
 * pure half stays importable from client code — nothing in this file may reach for the
 * Unicode table, satori, or a Worker global.
 */

import { describe, expect, it } from 'vitest';

import {
  OG_CARD_VERSION,
  absoluteOgCardUrl,
  ogCardAltText,
  ogCardPath,
  parseOgCardPath,
} from './card-url';

const ARROW = { codePoints: [0x2190], name: 'LEFTWARDS ARROW' };
const ZWJ = { codePoints: [0x1f468, 0x200d, 0x1f4bb], name: 'MAN TECHNOLOGIST' };

describe('ogCardPath', () => {
  it('versions the path so a redesign busts every card at once', () => {
    expect(ogCardPath(ARROW)).toBe(`/og/v${OG_CARD_VERSION}/2190-leftwards-arrow.png`);
  });

  it('uses the same slug as the page the card represents', () => {
    expect(ogCardPath(ZWJ)).toBe(
      `/og/v${OG_CARD_VERSION}/1f468_200d_1f4bb-man-technologist.png`,
    );
  });
});

describe('parseOgCardPath', () => {
  it('round-trips a path built by ogCardPath', () => {
    expect(parseOgCardPath(ogCardPath(ARROW))).toBe('2190-leftwards-arrow');
    expect(parseOgCardPath(ogCardPath(ZWJ))).toBe('1f468_200d_1f4bb-man-technologist');
  });

  it('accepts a bare code-point slug, which is what an unnamed glyph gets', () => {
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/e000.png`)).toBe('e000');
  });

  it('rejects another version, so a stale card URL 404s rather than being re-minted', () => {
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION + 1}/2190-leftwards-arrow.png`)).toBeNull();
    expect(parseOgCardPath('/og/v0/2190-leftwards-arrow.png')).toBeNull();
    expect(parseOgCardPath('/og/2190-leftwards-arrow.png')).toBeNull();
  });

  it('rejects anything that is not a .png', () => {
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/2190-leftwards-arrow.jpg`)).toBeNull();
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/2190-leftwards-arrow`)).toBeNull();
  });

  it('rejects an empty or nested slug', () => {
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/.png`)).toBeNull();
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/a/b.png`)).toBeNull();
  });

  it('rejects characters a slug can never contain, so junk never reaches the cache key', () => {
    // Percent-encoding, spaces and uppercase are all outside the slug alphabet. Letting them
    // through would mint a distinct R2 object per spelling of the same glyph — and each one
    // is stored under a year-long immutable cache entry.
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/2190-Leftwards%20Arrow.png`)).toBeNull();
    expect(parseOgCardPath(`/og/v${OG_CARD_VERSION}/../secret.png`)).toBeNull();
  });

  it('ignores paths belonging to the app itself', () => {
    expect(parseOgCardPath('/symbol/2190-leftwards-arrow')).toBeNull();
    expect(parseOgCardPath('/')).toBeNull();
  });
});

describe('absoluteOgCardUrl', () => {
  it('is absolute, because og:image is not resolved against the page URL by every consumer', () => {
    expect(absoluteOgCardUrl(ARROW)).toBe(
      `https://alt-codes.craigory.dev/og/v${OG_CARD_VERSION}/2190-leftwards-arrow.png`,
    );
  });
});

describe('ogCardAltText', () => {
  it('describes the card for a reader who cannot see it', () => {
    expect(ogCardAltText({ name: 'LEFTWARDS ARROW', hex: 'U+2190' })).toBe(
      'LEFTWARDS ARROW (U+2190) shown at display size',
    );
  });

  it('falls back to the code point when the character has no name', () => {
    expect(ogCardAltText({ name: '', hex: 'U+E000' })).toBe('U+E000 shown at display size');
  });
});
