import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/auth':   API_INTERNAL_URL,
        '/api':    API_INTERNAL_URL,
        '/static': API_INTERNAL_URL,
      },
    },
  },
});
