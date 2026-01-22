// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["@babylonjs/havok"],
    },
    build: {
      // Babylon.js is a large 3D engine - adjust warning limit
      chunkSizeWarningLimit: 7000,
    },
  },

  adapter: cloudflare()
});