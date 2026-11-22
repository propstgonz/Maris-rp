























import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  getByName: `SELECT * FROM ${T.effect_types} WHERE name = ?`,

  list: `SELECT * FROM ${T.effect_types} ORDER BY label ASC`,

  insert: `
    INSERT INTO ${T.effect_types} (name, emoji, label, laburo_modifier, hp_delta_per_day, blocks_laburo, prevents_combat, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  countActiveInstances: `
    SELECT COUNT(*) AS cnt FROM ${T.player_effects}
    WHERE effect_type = ?
      AND (expires_at IS NULL OR expires_at > NOW())
  `,

  countItemReferences: `
    SELECT COUNT(*) AS cnt FROM ${T.items} WHERE consume_effect = ?
  `,

  delete: `DELETE FROM ${T.effect_types} WHERE name = ?`,
};


export async function listEffectTypes() {
  return query(SQL.list);
}


export async function getEffectType(name) {
  return (await queryOne(SQL.getByName, [name])) ?? null;
}


export async function createEffectType({
  name, emoji = '🎭', label, laburoModifier = 0, hpDeltaPerDay = 0, blocksLaburo = false,
  preventsCombat = false, description = '',
}) {
  if (await queryOne(SQL.getByName, [name])) {
    throw new Error(`Ya existe un tipo de estado con el nombre \`${name}\`. Elige un nombre diferente.`);
  }

  await execute(SQL.insert, [name, emoji, label, laburoModifier, hpDeltaPerDay, blocksLaburo ? 1 : 0, preventsCombat ? 1 : 0, description]);
  logger.info(`[EffectTypes] Tipo de estado creado: "${name}" (${label})`);

  return queryOne(SQL.getByName, [name]);
}


export async function updateEffectType(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de estado llamado \`${name}\`.`);

  const fields = [];
  const values = [];

  const map = {
    emoji:          'emoji',
    label:          'label',
    laburoModifier: 'laburo_modifier',
    hpDeltaPerDay:  'hp_delta_per_day',
    blocksLaburo:   'blocks_laburo',
    preventsCombat: 'prevents_combat',
    description:    'description',
  };
  const booleanKeys = new Set(['blocksLaburo', 'preventsCombat']);

  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(booleanKeys.has(key) ? (updates[key] ? 1 : 0) : updates[key]);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(name);
  await execute(`UPDATE ${T.effect_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[EffectTypes] Tipo de estado "${name}" actualizado: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [name]);
}


export async function deleteEffectType(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de estado llamado \`${name}\`.`);

  const { cnt: activeInstances } = await queryOne(SQL.countActiveInstances, [name]);
  if (activeInstances > 0) {
    throw new Error(
      `No se puede eliminar \`${name}\`: hay **${activeInstances}** instancia(s) activa(s) sobre jugadores. ` +
      `Quítalas primero con \`/effect remove\`.`
    );
  }

  const { cnt: itemRefs } = await queryOne(SQL.countItemReferences, [name]);
  if (itemRefs > 0) {
    throw new Error(
      `No se puede eliminar \`${name}\`: **${itemRefs}** ítem(s) del catálogo lo aplican al consumirse. ` +
      `Modifica esos ítems primero con \`/item modify\`.`
    );
  }

  await execute(SQL.delete, [name]);
  logger.info(`[EffectTypes] Tipo de estado eliminado: "${name}"`);
  return existing;
}
