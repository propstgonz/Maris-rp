import { readFileSync }   from 'fs';
import { join }           from 'path';
import { MessageFlags }   from 'discord.js';
import logger              from './logger.js';

const CONFIG_PATH = process.env.CONFIG_PATH ?? join(process.cwd(), 'config.json');

let config;

try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  logger.info(`[Permissions] Config cargada desde: ${CONFIG_PATH}`);
} catch (err) {
  logger.error(`[Permissions] No se pudo leer config.json en "${CONFIG_PATH}": ${err.message}`);
  logger.error('[Permissions] Asegúrate de que el fichero existe y tiene formato JSON válido.');
  process.exit(1);
}

const ROLE_ROLEPRIEST = [...new Set(config.roles?.staff ?? [])];

const HOME_GUILD_ID = process.env.GUILD_ID;

function hasAnyRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  return roleIds.some(id => member.roles.cache.has(id));
}

export async function resolveMember(interaction) {
  if (interaction.member) return interaction.member;
  if (!HOME_GUILD_ID) return null;

  const guild = interaction.client.guilds.cache.get(HOME_GUILD_ID);
  if (!guild) return null;

  return guild.members.fetch(interaction.user.id).catch(() => null);
}

export function resolveGuild(interaction) {
  if (interaction.guild) return interaction.guild;
  if (!HOME_GUILD_ID) return null;
  return interaction.client.guilds.cache.get(HOME_GUILD_ID) ?? null;
}

export function isRolepriest(member) {
  return hasAnyRole(member, ROLE_ROLEPRIEST);
}

export async function requireRolepriest(interaction) {
  const member = await resolveMember(interaction);
  if (isRolepriest(member)) return true;
  await interaction.reply({
    content: '❌ Necesitas permisos de **Rolepriest** para usar este comando.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export { config };

export { ROLE_ROLEPRIEST };
