import { readFileSync }   from 'fs';
import { join }           from 'path';
import { MessageFlags }   from 'discord.js';
import logger              from './logger.js';
import { queryOne }        from '../database/index.js';
import { T }                from '../database/tables.js';

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

const ROLE_STAFF      = config.roles?.staff      ?? [];
const ROLE_MAP_PRIEST = config.roles?.mapPriest  ?? [];
const ROLE_ROLEPRIEST = [...new Set([...ROLE_STAFF, ...ROLE_MAP_PRIEST])];

const SQL_GET_CHARACTER_CREATED_AT = `SELECT character_created_at FROM ${T.players} WHERE discord_id = ?`;

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

export async function requireCharacter(interaction) {
  const row = await queryOne(SQL_GET_CHARACTER_CREATED_AT, [interaction.user.id]);
  if (row?.character_created_at) return true;

  await interaction.reply({
    content:
      '👤 Todavía no tienes un personaje. Usa `/personaje crear` para empezar a rolear ' +
      '(nombre completo, nacionalidad y, si quieres, una foto).',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export const PERMISSION_LEVELS = ['public', 'player', 'rolepriest'];

export function resolveEffectivePermission(command, subcommandName = null) {
  if (subcommandName && command.subcommandPermissions?.[subcommandName]) {
    return command.subcommandPermissions[subcommandName];
  }
  return command.permission ?? null;
}

export { config };

export const MAX_HP     = config.game?.maxHp     ?? 10;
export const MAX_HUNGER = config.game?.maxHunger ?? 10;

export const SURRENDER_SURVIVAL_PERCENT = config.game?.surrenderSurvivalPercent ?? 75;
export const SURRENDER_LOOT_MIN_ITEMS   = config.game?.surrenderLootMinItems    ?? 1;
export const SURRENDER_LOOT_MAX_ITEMS   = config.game?.surrenderLootMaxItems    ?? 3;
export const BREEDING_COOLDOWN_HOURS    = config.game?.breedingCooldownHours    ?? 24;

export { ROLE_ROLEPRIEST };
