import { query } from '../database/index.js';
import { T } from '../database/tables.js';
import { getInventory } from '../services/inventoryService.js';
import { getItemsAtTile } from '../services/tileItemService.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { listRecruitableNpcTypesForOffice } from '../services/npcRecruitService.js';
import { getConstructionsByTypeAndTile, getTile } from '../services/mapService.js';
import { getConstructionTypeByName } from '../services/constructionTypeService.js';
import { getTileGatherables } from '../services/resourceGatherService.js';

const SQL = {
  allItems:             `SELECT name, display_name, is_consumable, item_type FROM ${T.items} ORDER BY display_name ASC`,
  allEffectTypes:       `SELECT name, label FROM ${T.effect_types} ORDER BY label ASC`,
  allConstructionTypes: `SELECT name, display_name FROM ${T.construction_types} ORDER BY display_name ASC`,
  allTerrainTypes:      `SELECT name, display_name FROM ${T.terrain_types} ORDER BY display_name ASC`,
  allFactions:          `SELECT name, display_name, emoji FROM ${T.factions} ORDER BY display_name ASC`,
  allZones:             `SELECT name, display_name FROM ${T.zones} ORDER BY display_name ASC`,
};

const CACHE_TTL_MS = 15_000;
const listCache = new Map();

async function cachedList(key, queryFn) {
  const cached = listCache.get(key);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) return cached.rows;
  const rows = await queryFn();
  listCache.set(key, { rows, cachedAt: Date.now() });
  return rows;
}

function textMatches(row, fields, needle) {
  if (!needle) return true;
  return fields.some(f => (row[f] ?? '').toLowerCase().includes(needle));
}

function normalizeQuery(query) {
  return (query ?? '').toLowerCase().trim();
}

export async function suggestItemNames(queryText, { onlyConsumable = false, onlyWeapons = false } = {}) {
  const needle = normalizeQuery(queryText);
  let rows = await cachedList('items', () => query(SQL.allItems));

  if (onlyWeapons) rows = rows.filter(it => it.item_type === 'arma');
  else if (onlyConsumable) rows = rows.filter(it => it.is_consumable);

  return rows
    .filter(it => textMatches(it, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(it => ({
      name:  it.name === it.display_name ? it.name : `${it.display_name} (${it.name})`,
      value: it.name,
    }));
}

export async function suggestInventoryItemNames(discordId, query) {
  const needle = normalizeQuery(query);
  let rows;
  try {
    rows = await getInventory(discordId);
  } catch {
    return [];
  }

  return rows
    .filter(row => row.name !== 'laburo')
    .filter(row => textMatches(row, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(row => ({
      name:  row.name === row.display_name ? row.name : `${row.display_name} (${row.name})`,
      value: row.name,
    }));
}

export async function suggestTileItemNames(discordId, query) {
  const needle = normalizeQuery(query);
  const player = await getPlayerByDiscordId(discordId);
  if (!player) return [];

  const rows = await getItemsAtTile(player.coord_x, player.coord_y);
  return rows
    .filter(row => textMatches(row, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(row => ({
      name:  `${row.emoji ?? '📦'} ${row.display_name} ×${row.quantity}`.slice(0, 100),
      value: row.name,
    }));
}

export async function suggestGatherableItemNames(discordId, queryText) {
  const needle = normalizeQuery(queryText);
  const player = await getPlayerByDiscordId(discordId);
  if (!player) return [];

  const tile = await getTile(player.coord_x, player.coord_y);
  if (!tile) return [];

  const rows = await getTileGatherables(tile);
  return rows
    .filter(row => textMatches(row, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(row => ({
      name:  `${row.emoji ?? '📦'} ${row.display_name} (${row.drop_chance_percent}%)`.slice(0, 100),
      value: row.name,
    }));
}

export async function suggestEffectTypeNames(queryText) {
  const needle = normalizeQuery(queryText);
  const rows = await cachedList('effectTypes', () => query(SQL.allEffectTypes));
  return rows
    .filter(et => textMatches(et, ['name', 'label'], needle))
    .slice(0, 25)
    .map(et => ({
      name:  et.name === et.label ? et.name : `${et.label} (${et.name})`,
      value: et.name,
    }));
}

export async function suggestConstructionTypeNames(queryText) {
  const needle = normalizeQuery(queryText);
  const rows = await cachedList('constructionTypes', () => query(SQL.allConstructionTypes));
  return rows
    .filter(ct => textMatches(ct, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(ct => ({
      name:  ct.name === ct.display_name ? ct.name : `${ct.display_name} (${ct.name})`,
      value: ct.name,
    }));
}

export async function suggestTerrainTypeNames(queryText) {
  const needle = normalizeQuery(queryText);
  const rows = await cachedList('terrainTypes', () => query(SQL.allTerrainTypes));
  return rows
    .filter(tt => textMatches(tt, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(tt => ({
      name:  tt.name === tt.display_name ? tt.name : `${tt.display_name} (${tt.name})`,
      value: tt.name,
    }));
}

export async function suggestZoneNames(queryText) {
  const needle = normalizeQuery(queryText);
  const rows = await cachedList('zones', () => query(SQL.allZones));
  return rows
    .filter(z => textMatches(z, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(z => ({
      name:  z.name === z.display_name ? z.name : `${z.display_name} (${z.name})`,
      value: z.name,
    }));
}

export async function suggestFactionNames(queryText) {
  const needle = normalizeQuery(queryText);
  const rows = await cachedList('factions', () => query(SQL.allFactions));
  return rows
    .filter(n => textMatches(n, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(n => ({
      name:  `${n.emoji ?? ''} ${n.display_name} (${n.name})`.trim(),
      value: n.name,
    }));
}

export async function handleItemAutocomplete(interaction, opts = {}) {
  const focused = interaction.options.getFocused();
  const choices = await suggestItemNames(focused, opts);
  await interaction.respond(choices).catch(() => {});
}

export async function handleInventoryItemAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestInventoryItemNames(interaction.user.id, focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleTileItemAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestTileItemNames(interaction.user.id, focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleGatherableItemAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestGatherableItemNames(interaction.user.id, focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleEffectTypeAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestEffectTypeNames(focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleConstructionTypeAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestConstructionTypeNames(focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleTerrainTypeAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestTerrainTypeNames(focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleZoneAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestZoneNames(focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleFactionAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const choices = await suggestFactionNames(focused);
  await interaction.respond(choices).catch(() => {});
}

export async function handleRecruitableNpcTypeAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const needle = normalizeQuery(focused);
  const tipo = interaction.options.getString('tipo');
  const x = interaction.options.getInteger('x');
  const y = interaction.options.getInteger('y');

  if (!tipo || x === null || y === null) return interaction.respond([]).catch(() => {});

  const constructionType = await getConstructionTypeByName(tipo.toLowerCase().trim());
  if (!constructionType) return interaction.respond([]).catch(() => {});

  const [office] = await getConstructionsByTypeAndTile(x, y, constructionType.id);
  if (!office) return interaction.respond([]).catch(() => {});

  const types = await listRecruitableNpcTypesForOffice(office.id);
  const choices = types
    .filter(t => textMatches(t, ['name', 'display_name'], needle))
    .slice(0, 25)
    .map(t => ({ name: `${t.emoji ?? ''} ${t.display_name} (${t.name})`.trim(), value: t.name }));

  await interaction.respond(choices).catch(() => {});
}
