import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export const PUBLIC_DIR = join(__dirname, 'public');
export const STATIC_DIR = join(PUBLIC_DIR, 'static');
export const STAFF_GUIDE_PATH = join(__dirname, '..', '..', 'docs', 'guia-staff.md');

export const CLIENT_ID       = process.env.CLIENT_ID;
export const CLIENT_SECRET   = process.env.DISCORD_CLIENT_SECRET;
export const GUILD_ID        = process.env.GUILD_ID;
export const BOT_TOKEN       = process.env.DISCORD_TOKEN;
export const PUBLIC_URL      = (process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
export const SESSION_SECRET  = process.env.API_SESSION_SECRET;
export const PORT            = process.env.API_PORT ?? 3000;
export const REDIRECT_URI    = `${PUBLIC_URL}/auth/callback`;

const missing = [];
if (!CLIENT_ID) missing.push('CLIENT_ID');
if (!CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
if (!GUILD_ID) missing.push('GUILD_ID');
if (!BOT_TOKEN) missing.push('DISCORD_TOKEN');
if (!PUBLIC_URL) missing.push('API_PUBLIC_URL');
if (!SESSION_SECRET) missing.push('API_SESSION_SECRET');
if (missing.length > 0) {
  logger.error(`[API] Faltan variables de entorno: ${missing.join(', ')} — revisa .env.example (sección "API"). No se puede arrancar el login sin ellas.`);
  process.exit(1);
}
