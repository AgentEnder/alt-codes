import vikeReact from 'vike-react/config';
import type { Config } from 'vike/types';

export default {
  extends: [vikeReact],
  // Rendered on demand by the Worker rather than prerendered. Prerendering is
  // what forced the CJK & Scripts bucket (12k+ glyphs) out of /symbol and onto
  // a client-only /glyph route, and what made a per-symbol social card
  // impossible — ~3,752 cards at ~161 KB is ~589 MB of git blobs in the Pages
  // branch. Both fall away once pages are built per request and edge-cached.
  prerender: false,
} satisfies Config;
