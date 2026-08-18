/**
 * The OG route end to end, against the REAL Unicode table — only the render step is stubbed,
 * because that is the part that talks to Google Fonts and the Twemoji CDN.
 *
 * Using the real table is the point: the thing most likely to break silently is a slug that
 * the page router resolves and this handler does not, which produces a card URL emitted in
 * every symbol page's `<head>` that 404s for every crawler and for no visitor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderGlyphCard = vi.fn();
const initSatori = vi.fn(async (_wasm: unknown) => undefined);
const initResvg = vi.fn(async (_wasm: unknown) => undefined);

vi.mock('../og/render', async () => {
  const actual = await vi.importActual<typeof import('../og/render')>('../og/render');
  return {
    ...actual,
    renderGlyphCard: (...args: unknown[]) => renderGlyphCard(...args),
    initSatori: (wasm: unknown) => initSatori(wasm),
    initResvg: (wasm: unknown) => initResvg(wasm),
  };
});

const { FontSourceUnavailableError } = await import('../og/font-source');
const { handleOgRequest } = await import('./og-handler');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
const WASM = { yoga: new Uint8Array([0]), resvg: new Uint8Array([0]) };

function ctxStub() {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
}

function get(path: string, init?: RequestInit) {
  return new Request(`https://alt-codes.craigory.dev${path}`, init);
}

beforeEach(() => {
  renderGlyphCard.mockReset();
  renderGlyphCard.mockResolvedValue({ png: PNG, asset: { kind: 'font' } });
  (globalThis as { caches?: unknown }).caches = undefined;
});

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

describe('handleOgRequest', () => {
  it('declines any path that is not a card, so the app keeps routing it', async () => {
    for (const path of ['/', '/symbol/2190-leftwards-arrow', '/og/v99/2190-x.png', '/og']) {
      expect(await handleOgRequest(get(path), undefined, ctxStub(), WASM)).toBeNull();
    }
  });

  it('renders a card for a real symbol', async () => {
    const res = await handleOgRequest(
      get('/og/v1/2190-leftwards-arrow.png'),
      undefined,
      ctxStub(),
      WASM,
    );

    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toBe('image/png');
    expect(res?.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(Array.from(new Uint8Array(await res!.arrayBuffer()))).toEqual([...PNG]);
  });

  it('feeds the card everything it draws, resolved from the Unicode table', async () => {
    // U+21D2, not U+2190: the plain arrows are in the CP437 bucket, and the category name is
    // the one field the handler has to look up rather than read off the entry.
    await handleOgRequest(get('/og/v1/21d2-rightwards-double-arrow.png'), undefined, ctxStub(), WASM);

    expect(renderGlyphCard).toHaveBeenCalledWith({
      codePoints: [0x21d2],
      char: '⇒',
      name: 'RIGHTWARDS DOUBLE ARROW',
      hex: 'U+21D2',
      altCode: null,
      categoryName: 'Arrows',
    });
  });

  it('carries the alt code, which is what this app exists to document', async () => {
    // U+2665 BLACK HEART SUIT is CP437 alt-3.
    await handleOgRequest(get('/og/v1/2665-black-heart-suit.png'), undefined, ctxStub(), WASM);

    expect(renderGlyphCard).toHaveBeenCalledWith(expect.objectContaining({ altCode: 3 }));
  });

  it('initialises both wasm modules before rendering, and only on a miss', async () => {
    await handleOgRequest(get('/og/v1/2190-leftwards-arrow.png'), undefined, ctxStub(), WASM);

    expect(initSatori).toHaveBeenCalledWith(WASM.yoga);
    expect(initResvg).toHaveBeenCalledWith(WASM.resvg);
  });

  it('404s a slug that resolves to no glyph, and refuses to cache that', async () => {
    const res = await handleOgRequest(get('/og/v1/ffffff-nope.png'), undefined, ctxStub(), WASM);

    expect(res?.status).toBe(404);
    // A code point unassigned today can be assigned by a Unicode bump, so this answer must
    // not outlive the deploy that gave it.
    expect(res?.headers.get('Cache-Control')).toBe('no-store');
    expect(renderGlyphCard).not.toHaveBeenCalled();
  });

  it('answers a HEAD with the headers and no body', async () => {
    const res = await handleOgRequest(
      get('/og/v1/2190-leftwards-arrow.png', { method: 'HEAD' }),
      undefined,
      ctxStub(),
      WASM,
    );

    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toBe('image/png');
    expect(res?.body).toBeNull();
  });

  it('answers a HEAD on an unknown slug with no body either', async () => {
    const res = await handleOgRequest(
      get('/og/v1/ffffff-nope.png', { method: 'HEAD' }),
      undefined,
      ctxStub(),
      WASM,
    );

    expect(res?.status).toBe(404);
    expect(res?.body).toBeNull();
  });

  it('405s anything that is not a read', async () => {
    const res = await handleOgRequest(
      get('/og/v1/2190-leftwards-arrow.png', { method: 'POST' }),
      undefined,
      ctxStub(),
      WASM,
    );

    expect(res?.status).toBe(405);
    expect(res?.headers.get('Allow')).toBe('GET, HEAD');
  });

  it('fails the request when the font source is unreachable, rather than serving a lesser card', async () => {
    // The rule the whole OG design turns on: a "no glyph available" card is served immutable
    // for a year, so writing one because Google returned a 503 would cache a lie until 2027.
    // A retryable 5xx is the only honest answer.
    renderGlyphCard.mockRejectedValue(new FontSourceUnavailableError('Google Fonts 503', 503));

    const res = await handleOgRequest(
      get('/og/v1/2190-leftwards-arrow.png'),
      undefined,
      ctxStub(),
      WASM,
    );

    expect(res?.status).toBe(503);
    expect(res?.headers.get('Cache-Control')).toBe('no-store');
    expect(res?.headers.get('Retry-After')).toBe('60');
  });

  it('does not swallow a fault it does not understand', async () => {
    renderGlyphCard.mockRejectedValue(new Error('satori exploded'));

    await expect(
      handleOgRequest(get('/og/v1/2190-leftwards-arrow.png'), undefined, ctxStub(), WASM),
    ).rejects.toThrow('satori exploded');
  });

  it('stores under the canonical slug, whatever spelling was requested', async () => {
    // The page router ignores the name half of a slug too, so `/og/v1/2190-whatever.png`
    // resolves. Keying R2 on the resolved entry stops each spelling minting its own object.
    const put = vi.fn(async () => undefined);
    const ctx = ctxStub();

    await handleOgRequest(
      get('/og/v1/2190-whatever.png'),
      { OG_CACHE: { get: async () => null, put } },
      ctx,
      WASM,
    );

    await Promise.all(ctx.pending);
    expect(put).toHaveBeenCalledWith(
      'v1/2190-leftwards-arrow.png',
      PNG,
      expect.anything(),
    );
  });
});
