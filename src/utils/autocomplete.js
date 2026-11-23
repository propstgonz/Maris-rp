import { query } from '../database/index.js';
import { T } from '../database/tables.js';
import { searchTypes as searchGoodsTypes } from '../services/goodsService.js';
import { searchTypes as searchPropertyTypes } from '../services/propertyService.js';
import { listRaces, listMenhirs } from '../services/profileService.js';
import { listSchools } from '../services/magicService.js';

const MAX_CHOICES = 25;
const MAX_NAME = 100;

const SQL = {
  ownGoods: `
    SELECT i.id, i.display_name, inv.quantity
    FROM ${T.inventory} inv JOIN ${T.items} i ON i.id = inv.item_id
    JOIN ${T.players} p ON p.id = inv.player_id
    WHERE p.discord_id = ? AND i.is_active = 1 AND i.display_name LIKE ?
    ORDER BY i.display_name LIMIT ${MAX_CHOICES}
  `,
  ownNpcNames: `
    SELECT n.name, COUNT(*) AS total
    FROM ${T.player_npcs} n JOIN ${T.players} p ON p.id = n.owner_player_id
    WHERE p.discord_id = ? AND n.name COLLATE utf8mb4_0900_ai_ci LIKE ?
    GROUP BY n.name ORDER BY n.name LIMIT ${MAX_CHOICES}
  `,
  ownProperties: `
    SELECT pr.id, pr.name, t.display_name, pr.level
    FROM ${T.properties} pr JOIN ${T.property_types} t ON t.id = pr.property_type_id
    JOIN ${T.players} p ON p.id = pr.owner_player_id
    WHERE p.discord_id = ? AND (pr.name LIKE ? OR t.display_name LIKE ?)
    ORDER BY t.display_name, pr.id LIMIT ${MAX_CHOICES}
  `,
};

function like(text) {
  return `%${String(text ?? '').replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

function clip(name) {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

function matches(text, ...values) {
  const needle = String(text ?? '').toLowerCase();
  return values.some(v => String(v ?? '').toLowerCase().includes(needle));
}

function quantity(value) {
  return Number(value).toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function typeLabel(row) {
  return clip(`${row.display_name}${row.is_active ? '' : ' (inactivo)'}`);
}

export async function goodsTypeChoices(text, options) {
  const rows = await searchGoodsTypes(text, MAX_CHOICES, options);
  return rows.map(r => ({ name: typeLabel(r), value: r.id }));
}

export async function ownGoodsChoices(discordId, text) {
  const rows = await query(SQL.ownGoods, [discordId, like(text)]);
  return rows.map(r => ({ name: clip(`${r.display_name} (tienes ${quantity(r.quantity)})`), value: r.id }));
}

export async function ownNpcNameChoices(discordId, text) {
  const rows = await query(SQL.ownNpcNames, [discordId, like(text)]);
  return rows.map(r => ({ name: clip(`${r.name} ×${r.total}`), value: r.name }));
}

export async function propertyTypeChoices(text, options) {
  const rows = await searchPropertyTypes(text, MAX_CHOICES, options);
  return rows.map(r => ({ name: typeLabel(r), value: r.id }));
}

export async function ownPropertyChoices(discordId, text) {
  const pattern = like(text);
  const rows = await query(SQL.ownProperties, [discordId, pattern, pattern]);
  return rows.map(r => ({
    name: clip(`#${r.id} ${r.display_name}${r.name ? ` «${r.name}»` : ''} (nivel ${r.level})`),
    value: r.id,
  }));
}

export async function raceChoices(text) {
  const rows = await listRaces();
  return rows.filter(r => matches(text, r.name, r.slug)).slice(0, MAX_CHOICES).map(r => ({ name: r.name, value: r.slug }));
}

export async function menhirChoices(text) {
  const rows = await listMenhirs();
  return rows.filter(r => matches(text, r.name, r.slug)).slice(0, MAX_CHOICES).map(r => ({ name: clip(r.name), value: r.slug }));
}

export async function schoolChoices(text, { includeInactive = false } = {}) {
  const rows = await listSchools({ includeInactive });
  return rows.filter(r => matches(text, r.name, r.slug)).slice(0, MAX_CHOICES).map(r => ({ name: r.name, value: r.slug }));
}
