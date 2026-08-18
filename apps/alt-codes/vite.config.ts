import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import vike from 'vike/plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { categoryDataPlugin } from './vite-plugin-category-data';
import { versionDataPlugin } from './vite-plugin-version-data';

export default defineConfig({
  plugins: [
    // `cloudflare()` MUST come before `vike()` — per vike.dev/cloudflare, that
    // ordering plus a recent compatibility_date is what lets Vike's dev RPC run
    // inside workerd with HMR intact. The plugin reads wrangler.toml for `main`,
    // the compat date, and the assets directory.
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    react(),
    tailwindcss(),
    categoryDataPlugin(),
    versionDataPlugin(),
    vike(),
  ],
  // Served at the root of its own hostname now, not under /alt-codes/ on
  // craigory.dev. The old path 301s here; see the design doc.
  base: '/',
});
