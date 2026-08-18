// The GitHub Pages 404.html SPA-redirect shim that used to live here is gone with
// the /glyph route it existed for. It rewrote "/alt-codes/?/glyph/…" back to a real
// path because a deep link to a non-prerendered page could only be reached through
// Pages' 404 handler. The Worker server-renders every URL, so there is nothing left
// to restore — and leaving it in would have it rewriting genuine query strings.

export function Head() {
  return (
    <>
      <title>Glyph Index — Unicode & Alt Code Reference</title>
      <meta
        name="description"
        content="A clean, fast reference for Unicode characters and Windows Alt codes. Browse by category, search by code point, and click to copy."
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/*
        Noto Emoji is the MONOCHROME sibling of Noto Color Emoji. It backstops the text
        (U+FE0E) half of a dual glyph: emoji-default characters like the clock faces have no
        mono form in a normal macOS/Linux stack, so without it both halves fall back to the
        color emoji font and render identically. Served in unicode-range subsets, so only the
        ranges actually used get fetched. Families must stay alphabetical — the css2 API
        rejects the request otherwise.
      */}
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Emoji&family=Playfair+Display:wght@600&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet"
      />
    </>
  );
}
