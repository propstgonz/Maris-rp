import { EmbedBuilder } from 'discord.js';
import { getEffectType } from '../services/effectTypesService.js';
import { originPhrase, genderLabel } from './text.js';
import { formatTemperature, describeTemperature } from './temperature.js';

export const COLORS = {
  GREEN:  0x2ecc71,
  YELLOW: 0xf39c12,
  RED:    0xe74c3c,
  BLUE:   0x3498db,
  DARK:   0x2c3e50,
  PURPLE: 0x9b59b6,
  GREY:   0x95a5a6,
  BLACK:  0x1a1a1a,
};

const ITEM_TYPE_META = {
  dinero:      { emoji: '💰', label: 'Dinero'      },
  laburo:      { emoji: '💪', label: 'Laburo'      },
  consumible:  { emoji: '🎒', label: 'Consumibles' },
  recurso:     { emoji: '⛏️', label: 'Recursos'    },
  herramienta: { emoji: '🔧', label: 'Herramientas'},
  arma:        { emoji: '🔫', label: 'Armas'       },
};

function buildBar(current, max, length = 10) {
  const ratio  = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filled = Math.round(ratio * length);
  const empty  = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function healthColor(hp, maxHp) {
  if (!maxHp) return COLORS.GREY;
  const ratio = hp / maxHp;
  if (ratio > 0.6) return COLORS.GREEN;
  if (ratio > 0.3) return COLORS.YELLOW;
  return COLORS.RED;
}

function hungerWarning(hunger, maxHunger) {
  if (hunger <= 0) return '\n🚨 **Te estás muriendo de hambre** — busca comida ya.';
  if (maxHunger > 0 && hunger / maxHunger <= 0.3) return '\n⚠️ *Tienes hambre, busca comida pronto.*';
  return '';
}

export function discordTimestamp(when, style = 'f') {
  const d = when instanceof Date ? when : new Date(when);
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

export function discordRelativeFromNow(secondsRemaining) {
  return discordTimestamp(new Date(Date.now() + Math.max(0, secondsRemaining) * 1000), 'R');
}

export function formatExpiry(isoString) {
  if (!isoString) return 'permanente';
  return `${discordTimestamp(isoString, 'f')} (${discordTimestamp(isoString, 'R')})`;
}

export function formatDate(isoString) {
  return discordTimestamp(isoString, 'd');
}

export function signed(n) {
  return (n >= 0 ? '+' : '') + n;
}

export async function buildStatsEmbed(stats, avatarUrl, maxHp = 10, maxHunger = 10, laburo = null, travel = null) {
  const isAlive    = Boolean(stats.is_alive);
  const statusIcon = isAlive ? '🟢' : '💀';
  const color      = isAlive ? healthColor(stats.hp, maxHp) : COLORS.BLACK;

  const hpBar     = buildBar(stats.hp,     maxHp);
  const hungerBar = buildBar(stats.hunger, maxHunger);

  let effectsValue = '*Ninguno*';
  if (stats.effects && stats.effects.length > 0) {
    effectsValue = (await Promise.all(stats.effects.map(async e => {
      const meta   = (await getEffectType(e.effect_type)) ?? { emoji: '❓', label: e.effect_type };
      const parts  = [`${meta.emoji} **${meta.label}**`];

      if (e.laburo_modifier  !== 0) parts.push(`laburo ${signed(e.laburo_modifier)}/laburar`);
      if (e.hp_delta_per_day !== 0) parts.push(`HP ${signed(e.hp_delta_per_day)}/día`);

      parts.push(`· *${formatExpiry(e.expires_at)}*`);
      return parts.join(' · ');
    }))).join('\n');
  }

  const displayName = stats.character_name
    ? `${stats.character_name} (@${stats.username})`
    : stats.username;

  const isImmortal = Boolean(stats.is_immortal);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${statusIcon} ${displayName}${isImmortal ? ' ♾️' : ''}`)
    .addFields(
      {
        name:   '❤️ Salud',
        value:  isImmortal
          ? `♾️ **Inmortal** *(vida real: ${stats.hp} / ${maxHp})*`
          : `\`${hpBar}\` **${stats.hp}** / ${maxHp}`,
        inline: true,
      },
      {
        name:   '🍖 Hambre',
        value:  `\`${hungerBar}\` **${stats.hunger}** / ${maxHunger}${hungerWarning(stats.hunger, maxHunger)}`,
        inline: true,
      },
      {
        name:   '\u200B',
        value:  '\u200B',
        inline: true,
      },
      {
        name:   '⚒️ Laburo',
        value:  laburo
          ? `**${laburo.available}** disponible ahora\n` +
            (laburo.cooldownSeconds > 0
              ? `⏳ *Vuelve a poder \`/laburo trabajar\` ${discordRelativeFromNow(laburo.cooldownSeconds)}*`
              : '✅ *Puede usar `/laburo trabajar` ahora*')
          : '*—*',
        inline: true,
      },
      {
        name:   '📍 Posición en el mapa',
        value:  travel
          ? `**X: ${stats.coord_x} · Y: ${stats.coord_y}**\n🚶 *Hacia (${travel.destX}, ${travel.destY}) — ETA ~${travel.etaHours}h*`
          : `**X: ${stats.coord_x} · Y: ${stats.coord_y}**`,
        inline: true,
      },
      {
        name:   '\u200B',
        value:  '\u200B',
        inline: true,
      },
      {
        name:  '🎭 Efectos activos',
        value: effectsValue,
      }
    )
    .setFooter({ text: `ID Discord: ${stats.discord_id} · Registrado el ${formatDate(stats.created_at)}` })
    .setTimestamp();

  if (stats.nationality || stats.origin_country) {
    embed.addFields({ name: '🌍 Origen', value: originPhrase(stats.nationality, stats.origin_country), inline: true });
  }
  if (stats.gender) {
    embed.addFields({ name: '⚧️ Género', value: genderLabel(stats.gender), inline: true });
  }
  if (stats.religion) {
    embed.addFields({ name: '🙏 Religión', value: stats.religion, inline: true });
  }
  if (stats.description) {
    embed.addFields({ name: '📝 Descripción', value: stats.description, inline: false });
  }

  embed.addFields({
    name:  '🏳️ Facción',
    value: stats.faction_display_name ? `${stats.faction_emoji ?? '🏳️'} ${stats.faction_display_name}` : '*Sin facción*',
    inline: true,
  });

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

export function buildInventoryEmbed(username, items, avatarUrl = null, weightInfo = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle(`🎒 Inventario de ${username}`)
    .setTimestamp();

  if (avatarUrl) embed.setThumbnail(avatarUrl);

  const weightFooter = weightInfo ? ` · ⚖️ ${weightInfo.weight}/${weightInfo.capacity} de capacidad` : '';

  if (items.length === 0) {
    embed.setDescription('*El inventario está vacío.*');
    if (weightInfo) embed.setFooter({ text: `⚖️ ${weightInfo.weight}/${weightInfo.capacity} de capacidad` });
    return embed;
  }

  const groups = new Map();
  for (const row of items) {
    if (!groups.has(row.item_type)) groups.set(row.item_type, []);
    groups.get(row.item_type).push(row);
  }

  for (const [type, typeItems] of groups.entries()) {
    const meta = ITEM_TYPE_META[type] ?? { emoji: '📦', label: type };

    const lines = typeItems.map(it => {
      const qty = Number.isInteger(it.quantity) ? it.quantity : it.quantity.toFixed(2);

      const durabilityStr = it.weapon_max_durability
        ? ` *(durabilidad: ${it.durability ?? it.weapon_max_durability}/${it.weapon_max_durability})*`
        : '';
      return `${it.emoji ?? '📦'} **${it.display_name}**: \`${qty}\`${durabilityStr}`;
    });

    embed.addFields({
      name:  `${meta.emoji} ${meta.label}`,
      value: lines.join('\n'),
    });
  }

  embed.setFooter({ text: `${items.length} tipo${items.length !== 1 ? 's' : ''} de ítem${weightFooter}` });
  return embed;
}

function hexToColorInt(hex) {
  if (!hex) return COLORS.BLUE;
  const parsed = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(parsed) ? COLORS.BLUE : parsed;
}

const LEGACY_CONSTRUCTION_EMOJI = {
  fabrica:            '🏭',
  edificio_habitable: '🏠',
  fortaleza:          '🏰',
  granja_mejorada:    '🌾',
  mina_mejorada:      '⛏️',
};

export function buildTileInfoEmbed(tile, tileItems = []) {
  const owner = tile.owner_username
    ? `<@${tile.owner_discord_id}> *(${tile.owner_username})*`
    : '*Territorio neutral*';

  const embed = new EmbedBuilder()
    .setColor(hexToColorInt(tile.terrain_color))
    .setTitle(`${tile.terrain_emoji ?? '🗺️'} ${tile.name}`)
    .setDescription(tile.description?.trim() || '*Sin descripción.*')
    .addFields(
      { name: '📍 Coordenadas', value: `(X: ${tile.coord_x}, Y: ${tile.coord_y})`, inline: true },
      { name: '🗂️ Tipo',        value: tile.terrain_display_name ?? '?',            inline: true },
      { name: '👤 Propietario', value: owner,                                       inline: true }
    );

  if (tile.terrain_requires_vehicle_category) {
    embed.addFields({ name: '🚧 Requiere vehículo', value: `**${tile.terrain_requires_vehicle_category}**`, inline: true });
  }

  if (tile.resource_type) {
    embed.addFields({ name: '🪨 Recurso de la casilla', value: tile.resource_type, inline: true });
  }

  if (tile.zone_display_name) {
    embed.addFields({ name: '🧭 Zona', value: `${tile.zone_emoji ?? '🧭'} ${tile.zone_display_name}`, inline: true });
  }

  if (tile.temperature != null) {
    const band = describeTemperature(tile.temperature);
    embed.addFields({
      name: '🌡️ Temperatura',
      value: `${band.emoji} **${formatTemperature(tile.temperature)}** · ${band.label}`,
      inline: true,
    });
  }

  if (tile.faction_name) {
    embed.addFields({ name: '🏳️ Facción', value: `${tile.faction_emoji ?? '🏳️'} ${tile.faction_display_name}`, inline: true });
  }

  if (tile.points_of_interest?.length > 0) {
    const lines = tile.points_of_interest.map(p =>
      `${p.emoji ?? '📍'} **${p.name}**${p.description ? ` — ${p.description}` : ''}`
    );
    embed.addFields({ name: '📍 Lugares de interés', value: lines.join('\n') });
  }

  if (tile.constructions.length > 0) {
    const lines = tile.constructions.map(c => {
      const emoji = c.ct_emoji ?? LEGACY_CONSTRUCTION_EMOJI[c.construction_type] ?? '🏗️';
      const label = c.ct_display_name ?? c.construction_type ?? 'Construcción';
      const unlock = c.unlocks_item_display ? ` → craftea **${c.unlocks_item_display}**` : '';
      const maxHealth = c.ct_max_health ?? 10;
      const health    = c.current_health ?? maxHealth;
      const healthStr = health <= 0 ? ' — 🏚️ **EN RUINAS**' : ` *(❤️ ${health}/${maxHealth})*`;

      let fuelStr = '';
      if (c.ct_fuel_item_name) {
        const level = c.fuel_level ?? 0;
        const cap   = c.ct_fuel_capacity != null ? c.ct_fuel_capacity : '∞';
        const rate  = c.ct_fuel_consumption_rate ?? 0;
        const days  = rate > 0 ? Math.floor(level / rate) : null;
        const left  = days === null ? '' : ` · ${days === 0 ? '⚠️ **se seca hoy**' : `~${days} día${days === 1 ? '' : 's'}`}`;
        fuelStr = `\n   ${c.ct_fuel_item_emoji ?? '⛽'} ${level}/${cap} ${c.ct_fuel_item_display ?? c.ct_fuel_item_name}${left}`;
      }
      let durabilityStr = '';
      if (c.ct_durability_loss_per_day) {
        const maxDurability = c.ct_max_durability ?? 100;
        const durability    = c.durability ?? maxDurability;
        durabilityStr = `\n   🛠️ ${durability}/${maxDurability}`;
      }
      return `${emoji} **${c.name}** *(${label}, ID: ${c.id})*${unlock}${healthStr}${fuelStr}${durabilityStr}`;
    });
    embed.addFields({ name: '🏗️ Construcciones', value: lines.join('\n') });
  } else {
    embed.addFields({ name: '🏗️ Construcciones', value: '*Ninguna*' });
  }

  if (tile.generators.length > 0) {
    const lines = tile.generators.map(g => `${g.emoji ?? '📦'} **${g.display_name}**: **${g.generation_rate}**/día`);
    embed.addFields({ name: '⚙️ Producción diaria', value: lines.join('\n') });
  } else {
    embed.addFields({ name: '⚙️ Producción diaria', value: '*Sin generadores configurados*' });
  }

  if (tileItems.length > 0) {
    const lines = tileItems.map(it => `${it.emoji ?? '📦'} **${it.display_name}**: \`${it.quantity}\``);
    embed.addFields({ name: '📦 Ítems en el suelo', value: lines.join('\n') });
  }

  embed.setFooter({ text: `ID interno: ${tile.id}` }).setTimestamp();
  return embed;
}

export function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.RED)
    .setDescription(`❌ ${message}`);
}

export function buildSuccessEmbed(title, description = '') {
  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle(`✅ ${title}`);
  if (description) embed.setDescription(description);
  return embed;
}
