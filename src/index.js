import 'dotenv/config';

import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';

import { closePool } from './database/index.js';

import logger            from './utils/logger.js';
import { loadCommands }  from './loaders/commandLoader.js';
import { loadEvents }    from './loaders/eventLoader.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel,
    Partials.Message,
  ],
});

client.commands = new Collection();

async function bootstrap() {
  logger.info('══════════════════════════════════════');
  logger.info('  Iniciando roleplay-bot…');
  logger.info('══════════════════════════════════════');

  if (!process.env.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN no está definido. Revisa tu fichero .env');
    process.exit(1);
  }

  if (!process.env.CLIENT_ID) {
    logger.warn('CLIENT_ID no está definido. El script deploy-commands.js lo necesitará.');
  }

  await loadCommands(client);

  await loadEvents(client);

  logger.info('Conectando a Discord…');
  await client.login(process.env.DISCORD_TOKEN);

}

async function shutdown(signal) {
  logger.info(`\nSeñal "${signal}" recibida. Cerrando conexiones…`);
  try {
    await closePool();
    logger.info('[DB] Conexión cerrada.');
  } catch (_) {}
  client.destroy();
  logger.info('[Discord] Cliente destruido.');
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Promesa rechazada sin capturar: ${reason}`);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  logger.error(`Excepción no capturada: ${err.message}`);
  console.error(err);

  process.exit(1);
});

bootstrap().catch(err => {
  logger.error(`Error fatal en bootstrap: ${err.message}`);
  console.error(err);
  process.exit(1);
});
