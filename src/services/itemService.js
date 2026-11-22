import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import { getEffectType } from './effectTypesService.js';
import { getItemCategory } from './itemCategoryService.js';

const SQL = {
  getByName: `SELECT * FROM ${T.items} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.items} WHERE id = ?`,
  listAll:   `SELECT * FROM ${T.items} ORDER BY item_type, display_name ASC`,

  insert: `
    INSERT INTO ${T.items}
      (name, display_name, item_type, description, emoji, image_filename,
       consume_hp_delta, consume_hunger_delta,
       consume_effect, consume_effect_duration_hours, is_consumable,
       weapon_damage, weapon_roll_1, weapon_roll_2, weapon_roll_3, weapon_roll_4, weapon_roll_5, weapon_roll_6,
       weapon_max_durability, triggers_newspaper_channel,
       weapon_ammo_item_name, weapon_ammo_cost, is_fuel, weight, category_name,
       heal_range, mount_hp_bonus, mount_damage_bonus, trade_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  setImage: `UPDATE ${T.items} SET image_filename = ? WHERE name = ?`,
  delete:   `DELETE FROM ${T.items} WHERE name = ?`,

  countInventory:     `SELECT COUNT(*) AS cnt FROM ${T.inventory} WHERE item_id = ?`,
  countTileItems:     `SELECT COUNT(*) AS cnt FROM ${T.tile_items} WHERE item_id = ?`,
  countAsIngredient:  `SELECT COUNT(*) AS cnt FROM ${T.recipe_ingredients} WHERE ingredient_item_id = ?`,
  countAsResult:      `SELECT COUNT(*) AS cnt FROM ${T.recipes} WHERE result_item_id = ?`,
  countAsConstructionIngredient: `SELECT COUNT(*) AS cnt FROM ${T.construction_type_ingredients} WHERE ingredient_item_id = ?`,
  countAsTileGenerator: `SELECT COUNT(*) AS cnt FROM ${T.tile_resource_generators} WHERE item_id = ?`,
  countAsFuel:          `SELECT COUNT(*) AS cnt FROM ${T.construction_types} WHERE fuel_item_id = ?`,
  countAsRecipeTool:    `SELECT COUNT(*) AS cnt FROM ${T.recipes} WHERE tool_item_id = ?`,
  countAsWeaponAmmo: `SELECT COUNT(*) AS cnt FROM ${T.items} WHERE weapon_ammo_item_name = ?`,
  countAsGrantsResource: `SELECT COUNT(*) AS cnt FROM ${T.construction_types} WHERE grants_resource_item_id = ?`,
  countAsUseResult:      `SELECT COUNT(*) AS cnt FROM ${T.construction_types} WHERE use_result_item_id = ?`,
  countAsMaintenance:    `SELECT COUNT(*) AS cnt FROM ${T.construction_types} WHERE maintenance_item_id = ?`,
  countAsNpcToolGrants:  `SELECT COUNT(*) AS cnt FROM ${T.items} WHERE npc_tool_grants_item_id = ?`,
  countInConstructionStorage: `SELECT COUNT(*) AS cnt FROM ${T.construction_storage} WHERE item_id = ?`,
  countInFactionStorage:      `SELECT COUNT(*) AS cnt FROM ${T.faction_storage} WHERE item_id = ?`,
  countInNpcStorage:          `SELECT COUNT(*) AS cnt FROM ${T.npc_storage} WHERE item_id = ?`,
};

export async function listItems() {
  return query(SQL.listAll);
}

export async function getItemByName(name) {
  return queryOne(SQL.getByName, [name]);
}

export async function getItemById(id) {
  return queryOne(SQL.getById, [id]);
}

export async function createItem({
  name, displayName, itemType, description = '', emoji = '📦', imageFilename = null,
  consumeHpDelta = 0, consumeHungerDelta = 0, consumeEffect = null, consumeEffectDurationHours = null,
  isConsumable = false, isFuel = false, weight = 1, categoryName = null,
  healRange = 0, mountHpBonus = 0, mountDamageBonus = 0, tradeValue = 0,
}) {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error('El nombre solo puede contener letras minúsculas, números, guiones (-) y guiones bajos (_).');
  }
  if (typeof weight !== 'number' || weight < 0) {
    throw new Error('`peso` debe ser un número mayor o igual que 0.');
  }
  for (const [label, value] of [['alcance de curación', healRange], ['bonus de vida de montura', mountHpBonus], ['bonus de daño de montura', mountDamageBonus], ['valor de trueque', tradeValue]]) {
    if (typeof value !== 'number' || value < 0) {
      throw new Error(`\`${label}\` debe ser un número mayor o igual que 0.`);
    }
  }
  if (categoryName !== null && !(await getItemCategory(categoryName))) {
    throw new Error(`No existe ninguna categoría de ítems llamada "${categoryName}".`);
  }

  const insertResult = await execute(SQL.insert, [
    name, displayName, itemType, description, emoji, imageFilename,
    consumeHpDelta, consumeHungerDelta, consumeEffect, consumeEffectDurationHours,
    isConsumable ? 1 : 0,
    null, null, null, null, null, null, null,
    null,
    0,
    null, null,
    isFuel ? 1 : 0,
    weight, categoryName,
    healRange, mountHpBonus, mountDamageBonus, tradeValue,
  ]);
  return queryOne(SQL.getById, [insertResult.lastInsertRowid]);
}

const UPDATE_FIELD_MAP = {
  displayName: 'display_name',
  emoji: 'emoji',
  description: 'description',
  isConsumable: 'is_consumable',
  isFuel: 'is_fuel',
  consumeHpDelta: 'consume_hp_delta',
  consumeHungerDelta: 'consume_hunger_delta',
  consumeEffect: 'consume_effect',
  triggersNewspaperChannel: 'triggers_newspaper_channel',
  weight: 'weight',
  categoryName: 'category_name',
  healRange: 'heal_range',
  mountHpBonus: 'mount_hp_bonus',
  mountDamageBonus: 'mount_damage_bonus',
  tradeValue: 'trade_value',
};
const BOOLEAN_UPDATE_FIELDS = new Set(['isConsumable', 'isFuel', 'triggersNewspaperChannel']);

export async function updateItem(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún ítem "${name}" en el catálogo.`);

  if (updates.weight !== undefined && (typeof updates.weight !== 'number' || updates.weight < 0)) {
    throw new Error('`peso` debe ser un número mayor o igual que 0.');
  }
  if (updates.categoryName !== undefined && updates.categoryName !== null && !(await getItemCategory(updates.categoryName))) {
    throw new Error(`No existe ninguna categoría de ítems llamada "${updates.categoryName}".`);
  }
  for (const [key, label] of [['healRange', 'alcance de curación'], ['mountHpBonus', 'bonus de vida de montura'], ['mountDamageBonus', 'bonus de daño de montura'], ['tradeValue', 'valor de trueque']]) {
    if (updates[key] !== undefined && (typeof updates[key] !== 'number' || updates[key] < 0)) {
      throw new Error(`\`${label}\` debe ser un número mayor o igual que 0.`);
    }
  }

  const fields = [];
  const values = [];

  if (updates.npcToolGrantsItemName !== undefined) {
    let grantsItemId = null;
    if (updates.npcToolGrantsItemName !== null) {
      const grantsItem = await queryOne(SQL.getByName, [updates.npcToolGrantsItemName.toLowerCase().trim()]);
      if (!grantsItem) throw new Error(`El ítem "${updates.npcToolGrantsItemName}" no existe en el catálogo.`);
      grantsItemId = grantsItem.id;
    }
    fields.push('npc_tool_grants_item_id = ?');
    values.push(grantsItemId);
  }
  if (updates.npcToolGrantsRate !== undefined) {
    fields.push('npc_tool_grants_rate = ?');
    values.push(updates.npcToolGrantsRate);
  }
  if (updates.npcToolProducesLaburoRate !== undefined) {
    fields.push('npc_tool_produces_laburo_rate = ?');
    values.push(updates.npcToolProducesLaburoRate);
  }
  const finalNpcToolGrantsResource = updates.npcToolGrantsItemName !== undefined
    ? updates.npcToolGrantsItemName !== null
    : existing.npc_tool_grants_item_id != null;
  const finalNpcToolProducesLaburo = updates.npcToolProducesLaburoRate !== undefined
    ? updates.npcToolProducesLaburoRate
    : existing.npc_tool_produces_laburo_rate;
  if (finalNpcToolGrantsResource && finalNpcToolProducesLaburo != null) {
    throw new Error('Un ítem-herramienta de NPC no puede dar Laburo y un recurso a la vez — elige uno.');
  }
  for (const [key, column] of Object.entries(UPDATE_FIELD_MAP)) {
    if (updates[key] === undefined) continue;
    const raw = updates[key];
    fields.push(`${column} = ?`);
    values.push(BOOLEAN_UPDATE_FIELDS.has(key) ? (raw ? 1 : 0) : raw);
  }
  if (fields.length === 0) return existing;

  values.push(name);
  await execute(`UPDATE ${T.items} SET ${fields.join(', ')} WHERE name = ?`, values);
  return queryOne(SQL.getByName, [name]);
}

export async function setItemImage(name, imageFilename) {
  await execute(SQL.setImage, [imageFilename, name]);
  return queryOne(SQL.getByName, [name]);
}

export async function deleteItem(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún ítem "${name}" en el catálogo.`);

  const usageChecks = [
    [SQL.countInventory, 'en inventarios de jugadores'],
    [SQL.countTileItems, 'tirado en casillas del mapa'],
    [SQL.countAsIngredient, 'como ingrediente de recetas'],
    [SQL.countAsResult, 'como resultado de una receta'],
    [SQL.countAsConstructionIngredient, 'como ingrediente de construcciones'],
    [SQL.countAsTileGenerator, 'como recurso generado por una o más casillas'],
    [SQL.countAsFuel, 'como combustible configurado de uno o más tipos de construcción'],
    [SQL.countAsRecipeTool, 'como herramienta que abarata el Laburo de una o más recetas'],
    [SQL.countAsGrantsResource, 'como recurso que produce pasivamente uno o más tipos de construcción'],
    [SQL.countAsUseResult, 'como resultado de usar uno o más tipos de construcción'],
    [SQL.countAsMaintenance, 'como coste de mantenimiento de uno o más tipos de construcción'],
    [SQL.countAsNpcToolGrants, 'como recurso que produce una o más herramientas de NPC'],
    [SQL.countInConstructionStorage, 'guardado en el almacén de una o más construcciones'],
    [SQL.countInFactionStorage, 'guardado en el almacén de una o más facciones'],
    [SQL.countInNpcStorage, 'guardado en el almacén de uno o más NPCs'],
  ];
  for (const [sql, label] of usageChecks) {
    const { cnt } = await queryOne(sql, [existing.id]);
    if (cnt > 0) throw new Error(`No se puede eliminar "${name}": está en uso ${label} (${cnt}).`);
  }

  const { cnt: ammoCnt } = await queryOne(SQL.countAsWeaponAmmo, [existing.name]);
  if (ammoCnt > 0) throw new Error(`No se puede eliminar "${name}": es la munición configurada de ${ammoCnt} arma(s) del catálogo.`);

  await execute(SQL.delete, [name]);
  return existing;
}

const WEAPON_FIELD_MAP = {
  damage: 'weapon_damage',
  structureDamage: 'weapon_structure_damage',
  roll1: 'weapon_roll_1', roll2: 'weapon_roll_2', roll3: 'weapon_roll_3',
  roll4: 'weapon_roll_4', roll5: 'weapon_roll_5', roll6: 'weapon_roll_6',
  maxDurability: 'weapon_max_durability',
  ammoItemName: 'weapon_ammo_item_name',
  ammoCost: 'weapon_ammo_cost',
  areaDamage: 'weapon_area_damage',
  areaEffect: 'weapon_area_effect',
  areaEffectDurationHours: 'weapon_area_effect_duration_hours',
};
const WEAPON_BOOLEAN_FIELDS = new Set(['areaDamage']);

export async function configureItemWeapon(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún ítem "${name}" en el catálogo.`);
  if (existing.item_type !== 'arma') {
    throw new Error(`"${existing.display_name}" no es de tipo arma (es "${existing.item_type}") — no se le puede configurar daño/munición.`);
  }

  if (updates.ammoItemName !== undefined && updates.ammoItemName !== null) {
    if (updates.ammoItemName === 'laburo') {
      throw new Error('El Laburo no puede usarse como munición — usa un ítem normal.');
    }
    if (!(await queryOne(SQL.getByName, [updates.ammoItemName]))) {
      throw new Error(`No existe ningún ítem "${updates.ammoItemName}" en el catálogo para usar como munición.`);
    }
  }

  if (updates.areaEffect !== undefined && updates.areaEffect !== null && !(await getEffectType(updates.areaEffect))) {
    throw new Error(`No existe ningún tipo de estado llamado "${updates.areaEffect}".`);
  }

  for (const key of ['damage', 'structureDamage', 'roll1', 'roll2', 'roll3', 'roll4', 'roll5', 'roll6']) {
    if (updates[key] !== undefined && updates[key] !== null && (!Number.isFinite(updates[key]) || updates[key] < 0)) {
      throw new Error(`\`${key}\` debe ser un número ≥ 0 (o vacío para quitarlo, si el campo lo admite).`);
    }
  }
  if (updates.ammoCost !== undefined && updates.ammoCost !== null && (!Number.isFinite(updates.ammoCost) || updates.ammoCost <= 0)) {
    throw new Error('`ammoCost` debe ser un número mayor que 0 (o vacío si el arma no requiere munición) — munición gratis (0) o negativa (que la GANARÍAS al disparar) no tiene sentido.');
  }
  if (updates.areaEffectDurationHours !== undefined && updates.areaEffectDurationHours !== null && (!Number.isFinite(updates.areaEffectDurationHours) || updates.areaEffectDurationHours <= 0)) {
    throw new Error('`areaEffectDurationHours` debe ser un número mayor que 0 (o vacío para permanente).');
  }
  if (updates.maxDurability !== undefined && updates.maxDurability !== null) {
    if (!Number.isInteger(updates.maxDurability) || updates.maxDurability <= 0) {
      throw new Error('`maxDurability` debe ser un número entero mayor que 0 — un arma "irrompible" se consigue OMITIENDO este campo, no poniendo 0 (el código ya trata "sin configurar" y "0" como el mismo caso: irrompible, justo lo contrario de lo que "0 de durabilidad" parecería significar).');
    }
  }
  const effectiveArea = updates.areaDamage !== undefined ? updates.areaDamage : Boolean(existing.weapon_area_damage);
  if (updates.areaEffect && !effectiveArea) {
    throw new Error('`areaEffect` exige que el arma tenga `areaDamage:true` (en esta misma llamada, o ya lo tuviera antes) — sin eso no hay "toda la casilla" a la que aplicárselo.');
  }

  const fields = [];
  const values = [];
  for (const [key, column] of Object.entries(WEAPON_FIELD_MAP)) {
    if (updates[key] === undefined) continue;
    const raw = updates[key];
    fields.push(`${column} = ?`);
    values.push(WEAPON_BOOLEAN_FIELDS.has(key) ? (raw ? 1 : 0) : raw);
  }
  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para configurar (daño, daño a estructuras, dado_N, durabilidad, munición o área).');
  }

  values.push(name);
  await execute(`UPDATE ${T.items} SET ${fields.join(', ')} WHERE name = ?`, values);
  return queryOne(SQL.getByName, [name]);
}

const VEHICLE_CATEGORIES = ['aereo', 'maritimo', 'terrestre'];

export async function configureItemVehicle(name, category, speedMultiplier = 1) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún ítem "${name}" en el catálogo.`);
  if (existing.item_type !== 'vehiculo') {
    throw new Error(`"${existing.display_name}" no es de tipo vehículo (es "${existing.item_type}") — no se le puede configurar categoría de transporte.`);
  }
  if (!VEHICLE_CATEGORIES.includes(category)) {
    throw new Error(`Categoría de transporte inválida: "${category}" (debe ser aereo, maritimo o terrestre).`);
  }
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new Error('El multiplicador de velocidad debe ser un número mayor que 0.');
  }

  await execute(`UPDATE ${T.items} SET vehicle_category = ?, vehicle_speed_multiplier = ? WHERE name = ?`, [category, speedMultiplier, name]);
  return queryOne(SQL.getByName, [name]);
}
