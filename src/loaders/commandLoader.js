import { readdirSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, basename } from 'path';
import logger from '../utils/logger.js';
import { PERMISSION_LEVELS } from '../utils/permissions.js';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);
const COMMANDS_DIR = join(__dirname, '..', 'commands');

function collectJsFiles(dir) {
  const results = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat     = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.endsWith('.js')) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function loadCommands(client) {
  let loaded  = 0;
  let skipped = 0;

  let files;
  try {
    files = collectJsFiles(COMMANDS_DIR);
  } catch (err) {
    logger.warn(`[CommandLoader] No se pudo leer el directorio de comandos: ${err.message}`);
    return { loaded, skipped };
  }

  for (const filePath of files) {
    try {
      const module  = await import(pathToFileURL(filePath).href);
      const command = module.default;

      if (!command) {
        logger.warn(`[CommandLoader] Sin export default → omitido: ${filePath}`);
        skipped++;
        continue;
      }

      if (!command.data?.name) {
        logger.warn(`[CommandLoader] Sin data.name → omitido: ${filePath}`);
        skipped++;
        continue;
      }

      if (typeof command.execute !== 'function') {
        logger.warn(`[CommandLoader] Sin función execute → omitido: ${filePath}`);
        skipped++;
        continue;
      }

      if (client.commands.has(command.data.name)) {
        logger.error(
          `[CommandLoader] Nombre de comando duplicado: "/${command.data.name}" ` +
          `(${filePath}) ya estaba registrado por otro fichero — revisa que no haya ` +
          `dos ficheros de comando con el mismo data.name.`
        );
        process.exit(1);
      }

      command.category = basename(dirname(filePath));

      if (command.permission !== undefined && !PERMISSION_LEVELS.includes(command.permission)) {
        logger.error(
          `[CommandLoader] "${filePath}" declara permission:"${command.permission}", ` +
          `no es uno de: ${PERMISSION_LEVELS.join(' | ')}.`
        );
        process.exit(1);
      }
      if (command.subcommandPermissions !== undefined) {
        for (const [sub, level] of Object.entries(command.subcommandPermissions)) {
          if (!PERMISSION_LEVELS.includes(level)) {
            logger.error(
              `[CommandLoader] "${filePath}" declara subcommandPermissions.${sub}:"${level}", ` +
              `no es uno de: ${PERMISSION_LEVELS.join(' | ')}.`
            );
            process.exit(1);
          }
        }
      }

      client.commands.set(command.data.name, command);
      loaded++;
      logger.debug(`[CommandLoader] ✓ /${command.data.name}`);
    } catch (err) {
      logger.error(`[CommandLoader] Error al importar ${filePath}: ${err.message}`);
      console.error(err);
      skipped++;
    }
  }

  logger.info(`[CommandLoader] ${loaded} comandos cargados · ${skipped} omitidos.`);
  return { loaded, skipped };
}
