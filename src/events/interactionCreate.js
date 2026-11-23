import { Events, MessageFlags } from 'discord.js';
import logger from '../utils/logger.js';
import { parseCustomId, assertComponentAccess } from '../utils/componentAuth.js';
import { COMPONENT_HANDLERS } from '../components/registry.js';
import { UserFacingError } from '../utils/errors.js';
import { isDatabaseReady } from '../database/index.js';

const EXPIRED_COMPONENT_DELAY_MS = 2500;

const EXPIRED_COMPONENT_MESSAGE = {
  content: 'Este botón ha caducado; vuelve a lanzar el comando.',
  flags: MessageFlags.Ephemeral,
};

function replyIfStillUnanswered(interaction) {
  setTimeout(() => {
    if (interaction.replied || interaction.deferred) return;
    interaction.reply(EXPIRED_COMPONENT_MESSAGE).catch(() => {});
  }, EXPIRED_COMPONENT_DELAY_MS).unref();
}

const STARTING_UP_MESSAGE = {
  content: '⏳ La aplicación se está iniciando (base de datos arrancando). Inténtalo de nuevo en unos segundos.',
  flags: MessageFlags.Ephemeral,
};

export default {
  name: Events.InteractionCreate,
  once: false,

  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) {
        await interaction.respond([]).catch(() => {});
        return;
      }
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.warn(`[Autocomplete] Error en /${interaction.commandName}: ${err.message}`);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const parsed = parseCustomId(interaction.customId);
      const handler = parsed ? COMPONENT_HANDLERS[parsed.ns] : null;

      if (!handler) {
        replyIfStillUnanswered(interaction);
        return;
      }

      if (!isDatabaseReady()) {
        await interaction.reply(STARTING_UP_MESSAGE).catch(() => {});
        return;
      }

      try {
        const ttlMs = typeof handler.ttlMs === 'function' ? handler.ttlMs(parsed) : handler.ttlMs;
        assertComponentAccess(interaction, parsed, { ttlMs });
        await handler.handle(interaction, parsed);
      } catch (err) {
        const isUserFacing = err instanceof UserFacingError;
        if (!isUserFacing) {
          logger.error(`[Component] Error en "${interaction.customId}": ${err.message}`);
          console.error(err);
        }
        const payload = {
          content: isUserFacing ? `❌ ${err.message}` : '❌ Ocurrió un error al procesar esto. Inténtalo de nuevo.',
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(
        `[Interaction] Comando desconocido: /${interaction.commandName} ` +
        `(usuario: ${interaction.user.tag})`
      );
      await interaction.reply({
        content:
          '❌ Comando no reconocido. Puede que esté desactualizado; ' +
          'avisa al Staff para que ejecute `/deploy-commands`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isDatabaseReady()) {
      await interaction.reply(STARTING_UP_MESSAGE).catch(() => {});
      return;
    }

    const subcommand = interaction.options.getSubcommand(false);
    const cmdLabel   = subcommand
      ? `/${interaction.commandName} ${subcommand}`
      : `/${interaction.commandName}`;

    logger.debug(
      `[CMD] ${cmdLabel} · ${interaction.user.tag} (${interaction.user.id})` +
      ` · guild: ${interaction.guildId}`
    );

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`[CMD] Error en ${cmdLabel}: ${err.message}`);
      console.error(err);

      const errorPayload = {
        content: err instanceof UserFacingError
          ? `❌ ${err.message}`
          : '❌ Ocurrió un error interno al ejecutar el comando. ' +
            'El problema ha sido registrado; avisa al Staff si persiste.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorPayload).catch(() => {});
      } else {
        await interaction.reply(errorPayload).catch(() => {});
      }
    }
  },
};
