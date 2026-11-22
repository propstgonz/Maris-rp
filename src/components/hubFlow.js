import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { getInventory, getInventoryWeight } from '../services/inventoryService.js';
import { getAvailableLaburo } from '../services/laburoService.js';
import { getTile, getTileWithDetails } from '../services/mapService.js';
import { getItemsAtTile, dropItem } from '../services/tileItemService.js';
import { getTravelStatus } from '../services/travelService.js';
import { previewEncountersAtTile } from '../services/npcEncounterService.js';
import { getFactionById } from '../services/factionService.js';
import { getPlayerRank } from '../services/permissionService.js';
import { getPlayerPendingProductionCount } from '../services/productionService.js';
import { getPlayerPendingNpcProductionCount } from '../services/npcProductionService.js';
import { buildEmpireMessage } from './empireFlow.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS, buildInventoryEmbed, buildTileInfoEmbed } from '../utils/embeds.js';
import { getAvatarUrl } from '../utils/playerAvatar.js';
import { logAction } from '../services/auditLogService.js';
import logger from '../utils/logger.js';
import { componentEmoji } from '../utils/emoji.js';

export const HUB_NS = 'jugar';

const MAX_SELECT_OPTIONS = 25;
const QTY_INPUT_ID = 'cantidad';

const SECTIONS = [
  { value: 'inv',    label: 'Inventario y objetos', emoji: '🎒', description: 'Ver lo que llevas, usar consumibles, tirar al suelo' },
  { value: 'craft',  label: 'Fabricar',             emoji: '⚒️', description: 'Craftear con lo que tienes' },
  { value: 'build',  label: 'Construir',            emoji: '🏗️', description: 'Levantar edificios en tu casilla' },
  { value: 'attack', label: 'Combate',              emoji: '⚔️', description: 'Atacar a quien tengas al alcance' },
  { value: 'map',    label: 'Mapa y viaje',         emoji: '🧭', description: 'Ver tu casilla y moverte' },
  { value: 'pj',     label: 'Personaje',            emoji: '👤', description: 'Ficha, estados y alertas' },
  { value: 'eventos', label: 'Eventos posibles',    emoji: '🎲', description: 'Qué te puede salir al paso en tu casilla' },
];

function backRow(discordId, extra = []) {
  return new ActionRowBuilder().addComponents(
    ...extra,
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: HUB_NS, action: 'back', owner: discordId }))
      .setLabel('Volver')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function buildHubMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }

  const { weight, capacity } = await getInventoryWeight(discordId);
  const laburo = await getAvailableLaburo(discordId);
  const travel = await getTravelStatus(discordId);

  const embed = new EmbedBuilder()
    .setColor(player.is_alive ? COLORS.BLUE : COLORS.BLACK)
    .setTitle(`${player.character_name ?? player.username}`)
    .addFields(
      { name: '❤️ Vida',    value: player.is_alive ? `${player.hp}` : '**Muerto**', inline: true },
      { name: '🍗 Hambre',  value: `${player.hunger}`, inline: true },
      { name: '💪 Laburo',  value: laburo.toFixed(2), inline: true },
      { name: '📍 Posición', value: `(${player.coord_x}, ${player.coord_y})`, inline: true },
      { name: '🎒 Carga',   value: `${weight}/${capacity}`, inline: true },
    );

  if (travel) {
    embed.addFields({ name: '🚶 De viaje', value: `Hacia (${travel.destX}, ${travel.destY})`, inline: true });
  }

  if (player.faction_id) {
    const faction = await getFactionById(player.faction_id);
    const rank = await getPlayerRank(player.id, player.faction_id);
    if (faction) {
      embed.addFields({
        name: '🏳️ Facción',
        value: `${faction.emoji ?? '🏳️'} ${faction.display_name}${rank ? ` — ${rank.emoji ?? ''} ${rank.display_name}` : ''}`,
        inline: true,
      });
    }
  }
  const pendingProduction = await getPlayerPendingProductionCount(player.id);
  if (pendingProduction > 0) {
    embed.addFields({
      name: '🏭 Producción',
      value: `${pendingProduction} construcción${pendingProduction === 1 ? '' : 'es'} con producción esperando`,
      inline: true,
    });
  }
  const pendingNpcProduction = await getPlayerPendingNpcProductionCount(player.id);
  if (pendingNpcProduction > 0) {
    embed.addFields({
      name: '👤 NPCs',
      value: `${pendingNpcProduction} NPC${pendingNpcProduction === 1 ? '' : 's'} con producción esperando`,
      inline: true,
    });
  }

  if (!player.is_alive) {
    embed.setDescription('Tu personaje está muerto: casi todo está bloqueado hasta que Staff te reviva, o hasta que uses `/personaje rendirse`.');
  }

  const avatarUrl = getAvatarUrl(player, '/jugar');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: HUB_NS, action: 'go', owner: discordId }))
    .setPlaceholder('¿Qué quieres hacer?')
    .addOptions(SECTIONS);

  const rows = [new ActionRowBuilder().addComponents(select)];

  if (pendingProduction > 0 || pendingNpcProduction > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId({ ns: HUB_NS, action: 'imperio', owner: discordId }))
        .setLabel('Ver mi imperio')
        .setEmoji('🏛️')
        .setStyle(ButtonStyle.Success)
    ));
  }

  return {
    embeds: [embed],
    components: rows,
    flags: MessageFlags.Ephemeral,
  };
}

async function sectionInventory(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  const items = await getInventory(discordId);
  const embed = buildInventoryEmbed(
    player.username, items, getAvatarUrl(player, '/jugar'), await getInventoryWeight(discordId)
  );

  const { buildInventoryActionRow } = await import('./inventoryFlow.js');
  const useRow = await buildInventoryActionRow(discordId);

  const droppable = items.filter(i => i.quantity > 0 && i.name !== 'laburo').slice(0, MAX_SELECT_OPTIONS);
  const rows = [];
  if (useRow) rows.push(useRow);
  if (droppable.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildCustomId({ ns: HUB_NS, action: 'drop', owner: discordId }))
        .setPlaceholder('Tirar algo al suelo…')
        .addOptions(droppable.map(i => ({
          label: `${i.display_name} (llevas ${i.quantity})`.slice(0, 100),
          value: i.name,
          emoji: componentEmoji(i.emoji, '📦'),
        })))
    ));
  }
  rows.push(backRow(discordId));

  return { embeds: [embed], components: rows };
}

async function sectionMap(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  const tile = await getTileWithDetails(player.coord_x, player.coord_y);

  const embed = tile
    ? buildTileInfoEmbed(tile, await getItemsAtTile(player.coord_x, player.coord_y))
    : new EmbedBuilder()
        .setColor(COLORS.GREY)
        .setTitle(`📍 (${player.coord_x}, ${player.coord_y})`)
        .setDescription('Esta casilla no está registrada en el mapa.');

  const dirs = [
    { dx: 0, dy: -1, label: 'Norte', emoji: '⬆️' },
    { dx: 0, dy: 1,  label: 'Sur',   emoji: '⬇️' },
    { dx: -1, dy: 0, label: 'Oeste', emoji: '⬅️' },
    { dx: 1, dy: 0,  label: 'Este',  emoji: '➡️' },
  ];
  const candidates = dirs.map(d => ({ ...d, x: player.coord_x + d.dx, y: player.coord_y + d.dy }));
  const existing = await Promise.all(candidates.map(d => (d.x >= 0 && d.y >= 0 ? getTile(d.x, d.y) : null)));
  const buttons = candidates
    .filter((d, i) => Boolean(existing[i]))
    .map(d =>
      new ButtonBuilder()
        .setCustomId(buildCustomId({ ns: HUB_NS, action: 'travel', owner: discordId, ctx: `${d.x}.${d.y}` }))
        .setLabel(d.label)
        .setEmoji(d.emoji)
        .setStyle(ButtonStyle.Primary)
    );

  const rows = [];
  if (buttons.length > 0) rows.push(new ActionRowBuilder().addComponents(...buttons));
  else embed.setFooter({ text: 'No hay casillas contiguas registradas. Para ir más lejos: /move x: y:' });
  rows.push(backRow(discordId));

  return { embeds: [embed], components: rows };
}

async function sectionEvents(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  const candidates = await previewEncountersAtTile(player.coord_x, player.coord_y);

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle(`🎲 Eventos posibles en (${player.coord_x}, ${player.coord_y})`);

  if (candidates.length === 0) {
    embed.setDescription('Nada registrado para esta casilla — ningún NPC salvaje puede salirte al paso aquí ahora mismo.');
  } else {
    embed.setDescription('Lo que puede aparecer al cruzar esta casilla o mientras estés parado en ella, de más a menos probable.');
    embed.addFields(candidates.slice(0, 25).map(c => ({
      name: `${c.emoji ?? (c.kind === 'group' ? '👥' : '👤')} ${c.displayName}`,
      value: `${c.chancePercent}% · ${c.isAggressive ? '⚔️ agresivo' : '🕊️ pasivo'}`,
      inline: true,
    })));
  }

  return { embeds: [embed], components: [backRow(discordId)] };
}

async function sectionCharacter(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  const laburo = await getAvailableLaburo(discordId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(`👤 ${player.character_name ?? player.username}`)
    .addFields(
      { name: '❤️ Vida',   value: player.is_alive ? `${player.hp}` : '**Muerto**', inline: true },
      { name: '🍗 Hambre', value: `${player.hunger}`, inline: true },
      { name: '💪 Laburo', value: laburo.toFixed(2), inline: true },
    );

  if (player.full_name)      embed.addFields({ name: 'Nombre completo', value: player.full_name, inline: true });
  if (player.origin_country) embed.addFields({ name: 'Origen', value: player.origin_country, inline: true });
  if (player.religion)       embed.addFields({ name: 'Religión', value: player.religion, inline: true });
  if (player.description)    embed.addFields({ name: 'Descripción', value: player.description });

  const avatarUrl = getAvatarUrl(player, '/jugar');
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  embed.setFooter({ text: 'Los estados activos y el detalle completo están en /personaje ficha.' });

  const alertsBtn = new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: HUB_NS, action: 'alerts', owner: discordId }))
    .setLabel('Mis alertas')
    .setEmoji('🔔')
    .setStyle(ButtonStyle.Secondary);

  return { embeds: [embed], components: [backRow(discordId, [alertsBtn])] };
}

function stripEphemeral(payload) {
  const { flags, ...rest } = payload;
  void flags;
  return { content: null, ...rest };
}

function asUpdate(payload, discordId) {
  const base = stripEphemeral(payload);
  const rows = [...(base.components ?? [])].slice(0, 4);
  return { ...base, components: [...rows, backRow(discordId)] };
}

export async function handleHubComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'back') {
    return interaction.update(stripEphemeral(await buildHubMessage(discordId)));
  }

  if (parsed.action === 'imperio') {
    return interaction.reply(await buildEmpireMessage(discordId));
  }

  if (parsed.action === 'alerts') {
    const { buildAlertsPanel } = await import('./alertsFlow.js');

    return interaction.update(asUpdate(await buildAlertsPanel(discordId), discordId));
  }

  if (parsed.action === 'travel') {
    const [x, y] = parsed.ctx.split('.').map(Number);

    const { startTravelFor } = await import('../commands/player/move.js');
    return startTravelFor(interaction, x, y, true);
  }

  if (parsed.action === 'drop') {
    const itemName = interaction.values[0];
    const row = (await getInventory(discordId)).find(r => r.name === itemName && r.quantity > 0);
    if (!row) throw new UserFacingError('Ya no llevas ese objeto.');
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(buildCustomId({ ns: HUB_NS, action: 'dropqty', owner: discordId, ctx: itemName }))
        .setTitle(`Tirar ${row.display_name}`.slice(0, 45))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(QTY_INPUT_ID)
              .setLabel(`¿Cuántas? (llevas ${row.quantity})`.slice(0, 45))
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('1')
              .setRequired(true)
              .setMaxLength(10)
          )
        )
    );
  }

  if (parsed.action === 'dropqty') {
    const itemName = parsed.ctx;
    const raw = interaction.fields.getTextInputValue(QTY_INPUT_ID).trim().replace(',', '.');
    const cantidad = Number(raw);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new UserFacingError(`\`${raw}\` no es una cantidad válida — tiene que ser un número mayor que 0.`);
    }

    const player = await getPlayerByDiscordId(discordId);

    await dropItem(discordId, player.coord_x, player.coord_y, itemName, cantidad);

    logger.info(`[/jugar] ${interaction.user.tag} tiró x${cantidad} "${itemName}" en (${player.coord_x}, ${player.coord_y})`);
    logAction({
      source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
      action: 'tile.item_drop', target: `(${player.coord_x},${player.coord_y})`,
      details: { item: itemName, quantity: cantidad, via: 'gui' },
    });

    return interaction.reply({
      content: `Has dejado **×${cantidad} ${itemName}** en (${player.coord_x}, ${player.coord_y}). Cualquiera que pase puede recogerlo.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const section = interaction.values[0];

  if (section === 'inv')     return interaction.update(await sectionInventory(discordId));
  if (section === 'map')     return interaction.update(await sectionMap(discordId));
  if (section === 'pj')      return interaction.update(await sectionCharacter(discordId));
  if (section === 'eventos') return interaction.update(await sectionEvents(discordId));

  if (section === 'craft') {
    const { buildCraftPickerMessage } = await import('./craftFlow.js');
    return interaction.update(asUpdate(await buildCraftPickerMessage(discordId), discordId));
  }
  if (section === 'build') {
    const { buildMenuMessage } = await import('./buildFlow.js');
    return interaction.update(asUpdate(await buildMenuMessage(discordId), discordId));
  }
  if (section === 'attack') {
    const { buildAttackKindMessage } = await import('./attackFlow.js');
    return interaction.update(asUpdate(await buildAttackKindMessage(discordId), discordId));
  }

  throw new UserFacingError('Esa sección ya no existe — vuelve a lanzar `/jugar`.');
}
