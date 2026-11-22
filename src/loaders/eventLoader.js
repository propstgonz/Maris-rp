import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const EVENTS_DIR = join(__dirname, '..', 'events');

export async function loadEvents(client) {
  let loaded  = 0;
  let skipped = 0;

  let files;
  try {
    files = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.js'));
  } catch (err) {
    logger.warn(`[EventLoader] No se pudo leer el directorio de eventos: ${err.message}`);
    return;
  }

  for (const file of files) {
    const filePath = join(EVENTS_DIR, file);

    try {
      const module = await import(pathToFileURL(filePath).href);
      const event  = module.default;

      if (!event) {
        logger.warn(`[EventLoader] Sin export default → omitido: ${file}`);
        skipped++;
        continue;
      }

      if (!event.name) {
        logger.warn(`[EventLoader] Sin propiedad name → omitido: ${file}`);
        skipped++;
        continue;
      }

      if (typeof event.execute !== 'function') {
        logger.warn(`[EventLoader] Sin función execute → omitido: ${file}`);
        skipped++;
        continue;
      }

      const handler = (...args) => event.execute(...args, client);

      if (event.once) {
        client.once(event.name, handler);
      } else {
        client.on(event.name, handler);
      }

      loaded++;
      logger.debug(
        `[EventLoader] ✓ ${(event.once ? 'once' : 'on  ')} → ${event.name}`
      );
    } catch (err) {
      logger.error(`[EventLoader] Error al importar ${file}: ${err.message}`);
      console.error(err);
      skipped++;
    }
  }

  logger.info(`[EventLoader] ${loaded} eventos registrados · ${skipped} omitidos.`);
}
