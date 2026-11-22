import { REST, Routes, InteractionContextType } from 'discord.js';
import logger from '../utils/logger.js';

const PLAYER_CONTEXTS = [InteractionContextType.Guild, InteractionContextType.BotDM];

async function putCommands(rest, route, body, label) {
  if (body.length === 0) {
    logger.debug(`[CommandDeploy] Nada que registrar (${label}) — 0 comandos.`);
    return;
  }
  try {
    const result = await rest.put(route, { body });
    logger.info(`[CommandDeploy] ✔ ${result.length} comando(s) registrados → ${label}.`);
  } catch (err) {
    logger.error(`[CommandDeploy] Falló el registro de comandos (${label}): ${err.message}`);
  }
}

export function buildCommandDefs(commands) {
  const staffDefs  = [];
  const playerDefs = [];

  for (const command of commands.values()) {
    const json = command.data.toJSON();
    if (command.category === 'player') {
      playerDefs.push({ ...json, contexts: PLAYER_CONTEXTS });
    } else {
      staffDefs.push({ ...json });
    }
  }

  return { staffDefs, playerDefs };
}

export async function deployCommandsOnBoot(client) {
  if (process.env.AUTO_DEPLOY_COMMANDS === 'false') {
    logger.info('[CommandDeploy] AUTO_DEPLOY_COMMANDS=false — registro automático omitido.');
    return;
  }

  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

  if (!DISCORD_TOKEN || !CLIENT_ID) {
    logger.warn('[CommandDeploy] Falta DISCORD_TOKEN o CLIENT_ID — no se pueden registrar comandos automáticamente.');
    return;
  }

  if (client.commands.size === 0) {
    logger.warn('[CommandDeploy] client.commands está vacío — nada que registrar.');
    return;
  }

  const { staffDefs, playerDefs } = buildCommandDefs(client.commands);

  const rest = new REST().setToken(DISCORD_TOKEN);
  const globalRoute = Routes.applicationCommands(CLIENT_ID);

  if (GUILD_ID) {
    await putCommands(rest, Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), staffDefs, `staff → guild ${GUILD_ID} (instantáneo)`);
    await putCommands(rest, globalRoute, playerDefs, 'jugador → global + MD (hasta 1h de propagación)');
  } else {
    await putCommands(rest, globalRoute, [...staffDefs, ...playerDefs], 'todos (sin GUILD_ID) → global (hasta 1h de propagación)');
  }
}
