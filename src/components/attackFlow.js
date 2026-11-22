import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} from 'discord.js';
import {
  executeRangedAttack, executeMeleeAttack, executeNpcAttack, executeStructureAttack,
} from '../commands/player/attack.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { getConstructionsInRadius } from '../services/mapService.js';
import { getNpcsInRadius } from '../services/npcService.js';
import { getPlayerWeapons, weaponMaxRange, getAttackAvailability } from '../services/combatService.js';
import { hasEnough } from '../services/inventoryService.js';
import { KIND, collectTargets, collectTargetsAtTile } from '../services/attackTargetingService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { ATTACK_NS, buildAttackMenuButton } from '../utils/attackButtons.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS, discordRelativeFromNow } from '../utils/embeds.js';
import { componentEmoji } from '../utils/emoji.js';

export { ATTACK_NS };

const MAX_SELECT_OPTIONS = 25;
const MAX_TARGETS = MAX_SELECT_OPTIONS - 1;

const MELEE = 'm';
const PICK_COORDS = 'xy';

function toChatInputLike(interaction, options) {
  return {
    client: interaction.client,
    user: interaction.user,
    guild: interaction.guild,
    guildId: interaction.guildId,
    channel: interaction.channel,
    channelId: interaction.channelId,
    member: interaction.member,
    options: {
      getString:  (name) => (options[name] === undefined ? null : String(options[name])),
      getInteger: (name) => (options[name] === undefined ? null : Number(options[name])),
      getUser:    (name) => options[name] ?? null,
      getSubcommand: () => options._subcommand ?? null,
    },
    async reply(payload) {
      const isError = Boolean(payload.flags & MessageFlags.Ephemeral) || payload.content?.startsWith('❌');
      if (isError) {
        return interaction.update({ content: payload.content ?? null, embeds: payload.embeds ?? [], components: [] });
      }
      await interaction.update({ content: '⚔️ Ataque lanzado — el resultado va justo debajo.', embeds: [], components: [] });
      return interaction.followUp({
        embeds: payload.embeds ?? [],
        content: payload.content ?? undefined,
        components: payload.components ?? [],
      });
    },
  };
}

async function requireLivingPlayer(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }
  if (!player.is_alive) throw new UserFacingError('No puedes atacar estando muerto.');
  return player;
}

async function resolveWeapon(discordId, weaponRef) {
  if (weaponRef === MELEE) return null;
  const weapon = (await getPlayerWeapons(discordId)).find(w => String(w.id) === weaponRef);
  if (!weapon) {
    throw new UserFacingError('Ya no llevas esa arma encima.');
  }
  return weapon;
}

async function weaponAmmoWarning(discordId, weapon) {
  if (!weapon.weapon_ammo_item_name) return null;
  const cost = weapon.weapon_ammo_cost ?? 1;
  if (await hasEnough(discordId, weapon.weapon_ammo_item_name, cost)) return null;
  return `⚠ sin munición (${cost})`;
}

function describeAvailability(availability) {
  if (!availability.limited) return null;
  if (availability.cooldownRemainingSeconds > 0) {
    return `⏳ Aún estás recargando — podrás atacar ${discordRelativeFromNow(availability.cooldownRemainingSeconds)}.`;
  }
  if (availability.remainingToday === null) return null;
  if (availability.remainingToday === 0) {
    return `⛔ Ya has gastado tus **${availability.maxPerDay}** ataques de hoy.`;
  }
  return `🎯 Te quedan **${availability.remainingToday}** de **${availability.maxPerDay}** ataques hoy.`;
}

export async function buildAttackKindMessage(discordId) {
  const player  = await requireLivingPlayer(discordId);
  const weapons = await getPlayerWeapons(discordId);

  const options = [];
  for (const w of weapons.slice(0, MAX_SELECT_OPTIONS - 1)) {
    const range = weaponMaxRange(w);
    const ammoWarning = await weaponAmmoWarning(discordId, w);
    const parts = [];
    if (ammoWarning) parts.push(ammoWarning);
    parts.push(range > 0 ? `Alcance máx. ${range}` : 'Sin alcance (solo tu casilla)');
    if (w.weapon_damage)           parts.push(`daño ${w.weapon_damage}`);
    if (w.weapon_structure_damage) parts.push('daña estructuras');
    options.push({
      label: w.display_name.slice(0, 100),
      description: parts.join(' · ').slice(0, 100),
      value: String(w.id),
      emoji: componentEmoji(w.emoji, '🗡️'),
    });
  }

  options.push({
    label: 'Cuerpo a cuerpo (sin arma)',
    description: 'Solo contra jugadores de tu misma casilla',
    value: MELEE,
    emoji: '👊',
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: ATTACK_NS, action: 'weapon', owner: discordId }))
    .setPlaceholder('¿Con qué atacas?')
    .addOptions(options);

  const lines = [
    `Estás en **(${player.coord_x}, ${player.coord_y})**. Elige primero el arma: ` +
    'lo que puedas atacar depende de hasta dónde llegue.',
  ];
  const availability = describeAvailability(await getAttackAvailability(discordId));
  if (availability) lines.push(availability);

  const embed = new EmbedBuilder()
    .setColor(COLORS.RED)
    .setTitle('⚔️ Atacar — arma')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'El alcance de un arma es el de su mejor cara del dado, no el de todas.' });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}

export async function buildTargetMessage(discordId, weaponRef, onlyTile = null) {
  const player = await requireLivingPlayer(discordId);
  const weapon = await resolveWeapon(discordId, weaponRef);
  const range  = weapon ? weaponMaxRange(weapon) : 0;

  let targets = onlyTile
    ? await collectTargetsAtTile(player, weapon, onlyTile)
    : await collectTargets(player, weapon);

  if (targets.length === 0) {
    const where = onlyTile
      ? `en (${onlyTile.x}, ${onlyTile.y})`
      : (range > 0 ? `a menos de ${range} casillas` : 'en tu casilla');
    throw new UserFacingError(
      `No hay nada que atacar ${where} con **${weapon ? weapon.display_name : 'los puños'}**.`
    );
  }

  const truncated = targets.length > MAX_TARGETS;
  targets = targets.slice(0, MAX_TARGETS);

  const options = targets.map(t => ({
    label: t.label.slice(0, 100),
    description: t.detail.slice(0, 100),
    value: `${t.kind}.${t.id}`,
    emoji: t.emoji,
  }));

  if (weapon && range > 0 && !onlyTile) {
    options.push({
      label: 'Indicar coordenadas…',
      description: 'Apuntar a una casilla concreta dentro de tu alcance',
      value: PICK_COORDS,
      emoji: '📍',
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: ATTACK_NS, action: 'target', owner: discordId, ctx: weaponRef }))
    .setPlaceholder('¿A qué disparas?')
    .addOptions(options);

  const lines = [
    weapon
      ? `Con **${weapon.display_name}** (alcance máx. **${range}**) desde **(${player.coord_x}, ${player.coord_y})**.`
      : `A puño limpio, solo en tu casilla **(${player.coord_x}, ${player.coord_y})**.`,
  ];
  if (onlyTile) lines.push(`Filtrado a la casilla **(${onlyTile.x}, ${onlyTile.y})**.`);
  if (truncated) {
    lines.push(
      `⚠️ Hay más de ${MAX_TARGETS} objetivos a tu alcance — se muestran los **${MAX_TARGETS} más cercanos**. ` +
      'Usa **📍 Indicar coordenadas…** para apuntar a una casilla concreta.'
    );
  }

  const ammoWarning = weapon ? await weaponAmmoWarning(discordId, weapon) : null;
  if (ammoWarning) {
    lines.push(`⚠️ **No te queda munición para ${weapon.display_name}** — el disparo se rechazará al confirmarlo.`);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.RED)
    .setTitle('⚔️ Atacar — objetivo')
    .setDescription(lines.join('\n'))
    .setFooter({ text: '"4/6 caras llegan" = con cuántas caras del dado el disparo entra en alcance.' });

  const backRow = new ActionRowBuilder().addComponents(
    buildAttackMenuButton(discordId, 'Cambiar de arma', { emoji: '◀️', style: ButtonStyle.Secondary, action: 'restart' })
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), backRow] };
}

export function buildCoordsModal(discordId, weaponRef) {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId({ ns: ATTACK_NS, action: 'coord', owner: discordId, ctx: weaponRef }))
    .setTitle('Apuntar a una casilla');

  return modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('x').setLabel('Coordenada X')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setPlaceholder('Ej. 42')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('y').setLabel('Coordenada Y')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setPlaceholder('Ej. 17')
    )
  );
}

function readCoord(interaction, field) {
  const raw = interaction.fields.getTextInputValue(field).trim();
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new UserFacingError(`**${field.toUpperCase()} = "${raw}"** no es un número entero.`);
  }
  return value;
}

async function buildConfirmMessage(discordId, weaponRef, kind, targetId) {
  const player = await requireLivingPlayer(discordId);
  const weapon = await resolveWeapon(discordId, weaponRef);

  const target = (await collectTargets(player, weapon)).find(t => t.kind === kind && t.id === targetId);
  if (!target) {
    throw new UserFacingError('Ese objetivo ya no está a tu alcance.');
  }

  const lines = [
    `Vas a atacar a **${target.label}** ` +
    `${weapon ? `con **${weapon.display_name}**` : 'a puño limpio'}.`,
  ];
  const ammoWarning = weapon ? await weaponAmmoWarning(discordId, weapon) : null;
  if (ammoWarning) lines.push(`⚠️ **Sin munición para ${weapon.display_name}** — el ataque se rechazará.`);
  const availability = describeAvailability(await getAttackAvailability(discordId));
  if (availability) lines.push(availability);

  const embed = new EmbedBuilder()
    .setColor(COLORS.RED)
    .setTitle('⚔️ ¿Confirmas el ataque?')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Objetivo', value: target.detail })
    .setFooter({ text: 'El resultado se publicará en el canal.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId({
        ns: ATTACK_NS, action: 'go', owner: discordId, ctx: `${weaponRef}.${kind}.${targetId}`,
      }))
      .setLabel('Atacar')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: ATTACK_NS, action: 'retarget', owner: discordId, ctx: weaponRef }))
      .setLabel('Cambiar de objetivo')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: ATTACK_NS, action: 'cancel', owner: discordId }))
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function handleAttackComponent(interaction, parsed) {
  try {
    return await _handleAttackComponent(interaction, parsed);
  } catch (err) {
    if (!(err instanceof UserFacingError)) throw err;
    const payload = {
      content: `❌ ${err.message}`,
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        buildAttackMenuButton(interaction.user.id, 'Volver a empezar', { emoji: '🔄', style: ButtonStyle.Secondary, action: 'restart' })
      )],
    };
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return interaction.update(payload);
  }
}

async function _handleAttackComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'cancel') {
    return interaction.update({ content: 'Ataque cancelado.', embeds: [], components: [] });
  }

  if (parsed.action === 'counter' || parsed.action === 'restart') {
    return interaction.update(await buildAttackKindMessage(discordId));
  }

  if (parsed.action === 'weapon') {
    return interaction.update(await buildTargetMessage(discordId, interaction.values[0]));
  }

  if (parsed.action === 'retarget') {
    return interaction.update(await buildTargetMessage(discordId, parsed.ctx));
  }

  if (parsed.action === 'target') {
    const chosen = interaction.values[0];
    if (chosen === PICK_COORDS) {
      return interaction.showModal(buildCoordsModal(discordId, parsed.ctx));
    }
    const [kind, targetId] = chosen.split('.');
    return interaction.update(await buildConfirmMessage(discordId, parsed.ctx, kind, targetId));
  }

  if (parsed.action === 'coord') {
    const tile = { x: readCoord(interaction, 'x'), y: readCoord(interaction, 'y') };
    return interaction.update(await buildTargetMessage(discordId, parsed.ctx, tile));
  }

  const [weaponRef, kind, targetId] = parsed.ctx.split('.');
  const weapon = await resolveWeapon(discordId, weaponRef);

  if (!weapon && kind !== KIND.player) {
    throw new UserFacingError('Necesitas un arma para eso.');
  }

  if (kind === KIND.npc) {
    const player = await requireLivingPlayer(discordId);
    const npc = (await getNpcsInRadius(player.coord_x, player.coord_y, weaponMaxRange(weapon)))
      .find(n => String(n.id) === targetId);
    if (!npc) {
      throw new UserFacingError('Ese NPC ya no está a tu alcance.');
    }
    return executeNpcAttack(toChatInputLike(interaction, {
      arma: weapon.name, x: npc.coord_x, y: npc.coord_y, id: npc.id,
    }));
  }

  if (kind === KIND.construction) {
    const player = await requireLivingPlayer(discordId);
    const construction = (await getConstructionsInRadius(player.coord_x, player.coord_y, weaponMaxRange(weapon)))
      .find(c => String(c.id) === targetId);
    if (!construction) {
      throw new UserFacingError('Esa construcción ya no está a tu alcance.');
    }
    return executeStructureAttack(toChatInputLike(interaction, {
      tipo: construction.ct_name,
      arma: weapon.name,
      x: construction.coord_x,
      y: construction.coord_y,
      id: construction.id,
    }));
  }

  const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!targetUser) throw new UserFacingError('No se pudo resolver a ese jugador — puede que ya no esté en el servidor.');

  const shim = toChatInputLike(interaction, {});
  return weapon
    ? executeRangedAttack(shim, targetUser, weapon.name)
    : executeMeleeAttack(shim, targetUser);
}
