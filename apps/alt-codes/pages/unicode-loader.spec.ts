import { describe, expect, it } from 'vitest';
import { resolveEntry } from './unicode-loader.server';

/**
 * Regression cover for the gap that made /symbol and /og 404 every CJK
 * ideograph and every Hangul syllable: Unicode names those ranges
 * algorithmically instead of listing them, so they never enter the curated
 * dataset and a plain byCodePoints lookup misses all ~103,000 of them.
 */
describe('resolveEntry', () => {
  it('returns a curated entry unchanged', () => {
    expect(resolveEntry([0x00e9])?.name).toBe('LATIN SMALL LETTER E WITH ACUTE');
  });

  it('derives CJK ideograph names, which are not in the dataset', () => {
    expect(resolveEntry([0x4e2d])).toMatchObject({
      char: '中',
      name: 'CJK UNIFIED IDEOGRAPH-4E2D',
    });
  });

  it('composes Hangul syllable names from their jamo', () => {
    // Not a hex suffix like the ideographs — the name is built from the
    // lead/vowel/trail jamo, so 가 is GA and 한 is HAN.
    expect(resolveEntry([0xac00])?.name).toBe('HANGUL SYLLABLE GA');
    expect(resolveEntry([0xd55c])?.name).toBe('HANGUL SYLLABLE HAN');
  });

  it('derives other algorithmically-named scripts', () => {
    expect(resolveEntry([0x17000])?.name).toBe('TANGUT IDEOGRAPH-17000');
  });

  it('prefers the derived name over the generic block label', () => {
    // The Names data does carry something for these ranges, but it is the block
    // label — every ideograph comes back as "CJK Ideograph". Returning that
    // would make the page and the card useless, so the derived name wins.
    expect(resolveEntry([0x4e2d])?.name).not.toBe('CJK Ideograph');
  });

  it('still returns null for an unassigned code point, so callers 404', () => {
    expect(resolveEntry([0x0378])).toBeNull();
  });

  it('does not synthesize for multi-code-point sequences', () => {
    expect(resolveEntry([0x4e2d, 0x4e2d])).toBeNull();
  });
});
