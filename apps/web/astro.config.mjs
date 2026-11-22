import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

const MAP_SERVER_INTERNAL_URL = (process.env.MAP_SERVER_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/auth':   MAP_SERVER_INTERNAL_URL,
        '/api':    MAP_SERVER_INTERNAL_URL,
        '/static': MAP_SERVER_INTERNAL_URL,
      },
    },
  },
});
