import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { removeItem, getItemQuantity } from './inventoryService.js';
import { getAvailableLaburo, spendLaburo } from './laburoService.js';
import { placeConstructionInstance, countConstructionsAtTile } from './mapService.js';

const SQL = {
  getByName: `SELECT * FROM ${T.construction_types} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.construction_types} WHERE id = ?`,
  list:      `SELECT * FROM ${T.construction_types} ORDER BY display_name ASC`,

  getItemByName: `SELECT id, name, display_name, is_fuel FROM ${T.items} WHERE name = ?`,
  getRecipeForItem: `
    SELECT r.id FROM ${T.recipes} r JOIN ${T.items} i ON r.result_item_id = i.id WHERE i.name = ?
  `,
  getRecipeResultItemName: `
    SELECT i.name FROM ${T.recipes} r JOIN ${T.items} i ON r.result_item_id = i.id WHERE r.id = ?
  `,

  insert: `
    INSERT INTO ${T.construction_types}
      (name, display_name, emoji, description, laburo_cost, requires_resource_type,
       unlocks_recipe_id, grants_resource_item_id, grants_resource_rate, max_health,
       fuel_item_id, fuel_consumption_rate, fuel_capacity, is_landing_site, max_durability)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  insertIngredient: `
    INSERT INTO ${T.construction_type_ingredients} (construction_type_id, ingredient_item_id, quantity_required)
    VALUES (?, ?, ?)
  `,

  getIngredients: `
    SELECT cti.quantity_required, i.name, i.display_name, i.emoji
    FROM ${T.construction_type_ingredients} cti
    JOIN ${T.items} i ON cti.ingredient_item_id = i.id
    WHERE cti.construction_type_id = ?
  `,

  deleteIngredients: `DELETE FROM ${T.construction_type_ingredients} WHERE construction_type_id = ?`,

  setImage: `UPDATE ${T.construction_types} SET image_filename = ? WHERE name = ?`,

  countInstances: `SELECT COUNT(*) AS cnt FROM ${T.constructions} WHERE construction_type_id = ?`,

  delete: `DELETE FROM ${T.construction_types} WHERE name = ?`,

  getItemById: `SELECT id, name, display_name, emoji FROM ${T.items} WHERE id = ?`,
};

export async function listConstructionTypes() {
  return query(SQL.list);
}

export async function getConstructionTypeByName(name) {
  return (await queryOne(SQL.getByName, [name])) ?? null;
}

export async function setConstructionTypeImage(name, imageFilename) {
  await execute(SQL.setImage, [imageFilename, name]);
  return queryOne(SQL.getByName, [name]);
}

export async function getIngredients(constructionTypeId) {
  return query(SQL.getIngredients, [constructionTypeId]);
}

async function _resolveFuelItemId(fuelItemName) {
  if (fuelItemName === null) return null;
  if (fuelItemName === 'laburo') {
    throw new Error('El Laburo no puede usarse como combustible — usa un ítem normal marcado como combustible.');
  }
  const item = await queryOne(SQL.getItemByName, [fuelItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${fuelItemName}\` no existe en el catálogo.`);
  if (!item.is_fuel) {
    throw new Error(
      `El ítem \`${fuelItemName}\` no está marcado como combustible — actívalo primero con ` +
      `\`/item modify item:${fuelItemName} combustible:true\`.`
    );
  }
  return item.id;
}

async function _resolveMaintenanceItemId(maintenanceItemName) {
  if (maintenanceItemName === null) return null;
  if (maintenanceItemName === 'laburo') {
    throw new Error('El Laburo no puede usarse como mantenimiento — usa un ítem normal.');
  }
  const item = await queryOne(SQL.getItemByName, [maintenanceItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${maintenanceItemName}\` no existe en el catálogo.`);
  return item.id;
}

async function _validateDurabilityRepairToolName(toolItemName) {
  if (toolItemName === null) return;
  if (toolItemName === 'laburo') {
    throw new Error('El Laburo no puede usarse como herramienta de reparación — usa un ítem normal.');
  }
  const item = await queryOne(SQL.getItemByName, [toolItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${toolItemName}\` (herramienta) no existe en el catálogo.`);
}

export async function createConstructionType({
  name, displayName, emoji = '🏗️', description = '', laburoCost = 0,
  requiresResourceType = null, unlocksItemName = null,
  grantsResourceItemName = null, grantsResourceRate = null, ingredients = [],
  maxHealth = 10, maxDurability = 100,
  fuelItemName = null, fuelConsumptionRate = null, fuelCapacity = null,
  isLandingSite = false,
}) {
  if (await queryOne(SQL.getByName, [name])) {
    throw new Error(`Ya existe un tipo de construcción con el nombre \`${name}\`.`);
  }
  if (!Number.isInteger(maxHealth) || maxHealth < 1 || maxHealth > MAX_CONSTRUCTION_HEALTH) {
    throw new Error('La vida máxima debe ser un número entero entre 1 y 10.');
  }
  if (!Number.isInteger(maxDurability) || maxDurability < 1 || maxDurability > MAX_CONSTRUCTION_HEALTH) {
    throw new Error('La durabilidad máxima debe ser un número entero entre 1 y 1000.');
  }
  requiresResourceType = requiresResourceType ? requiresResourceType.trim().toLowerCase() : null;

  let unlocksRecipeId = null;
  if (unlocksItemName) {
    const recipe = await queryOne(SQL.getRecipeForItem, [unlocksItemName.toLowerCase().trim()]);
    if (!recipe) {
      throw new Error(`El ítem "${unlocksItemName}" no tiene ninguna receta de crafteo. Créala primero con \`/item create\`.`);
    }
    unlocksRecipeId = recipe.id;
  }

  let grantsResourceItemId = null;
  if (grantsResourceItemName) {
    const item = await queryOne(SQL.getItemByName, [grantsResourceItemName.toLowerCase().trim()]);
    if (!item) throw new Error(`El ítem "${grantsResourceItemName}" no existe en el catálogo.`);
    grantsResourceItemId = item.id;
  }

  const fuelItemId = await _resolveFuelItemId(fuelItemName);
  if (fuelItemId && !fuelConsumptionRate) {
    throw new Error('Si configuras `combustible_item`, también hace falta `combustible_tasa` (unidades/día que consume) — si no, nunca se descontaría nada del depósito.');
  }

  const id = await withTransaction(async () => {
    const result = await execute(SQL.insert, [
      name, displayName, emoji, description, laburoCost, requiresResourceType,
      unlocksRecipeId, grantsResourceItemId, grantsResourceRate, maxHealth,
      fuelItemId, fuelConsumptionRate, fuelCapacity, isLandingSite ? 1 : 0, maxDurability
    ]);
    const newId = result.lastInsertRowid;

    for (const { name: ingName, quantity } of ingredients) {
      const ingItem = await queryOne(SQL.getItemByName, [ingName]);
      if (!ingItem) {
        throw new Error(`El ítem de ingrediente \`${ingName}\` no existe en el catálogo.`);
      }
      await execute(SQL.insertIngredient, [newId, ingItem.id, quantity]);
    }

    return newId;
  });

  logger.info(`[ConstructionTypes] Tipo creado: "${name}" (${displayName})`);
  return queryOne(SQL.getById, [id]);
}

export async function updateConstructionType(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de construcción llamado \`${name}\`.`);

  const map = {
    displayName:           'display_name',
    emoji:                 'emoji',
    description:           'description',
    laburoCost:             'laburo_cost',
    requiresResourceType:   'requires_resource_type',
    maxHealth:              'max_health',
    maxDurability:          'max_durability',
    durabilityLossPerDay:   'durability_loss_per_day',

    destroyPolicy:          'destroy_policy',
    usePolicy:              'use_policy',
    refuelPolicy:           'refuel_policy',
    repairPolicy:           'repair_policy',
  };

  if (updates.maxHealth !== undefined && (!Number.isInteger(updates.maxHealth) || updates.maxHealth < 1 || updates.maxHealth > MAX_CONSTRUCTION_HEALTH)) {
    throw new Error('La vida máxima debe ser un número entero entre 1 y 10.');
  }
  if (updates.maxDurability !== undefined && (!Number.isInteger(updates.maxDurability) || updates.maxDurability < 1 || updates.maxDurability > MAX_CONSTRUCTION_HEALTH)) {
    throw new Error('La durabilidad máxima debe ser un número entero entre 1 y 1000.');
  }
  if (updates.durabilityLossPerDay !== undefined && updates.durabilityLossPerDay !== null && !(updates.durabilityLossPerDay > 0)) {
    throw new Error('La pérdida de durabilidad/día debe ser un número mayor que 0 (o vacío para desactivar el desgaste).');
  }
  if (updates.requiresResourceType !== undefined) {
    updates.requiresResourceType = updates.requiresResourceType ? updates.requiresResourceType.trim().toLowerCase() : null;
  }
  for (const [key, label] of [
    ['destroyPolicy', 'destruir'], ['usePolicy', 'usar'], ['refuelPolicy', 'repostar'], ['repairPolicy', 'reparar'],
  ]) {
    if (updates[key] !== undefined && !['any', 'owner', 'faccion', 'rolepriest'].includes(updates[key])) {
      throw new Error(`La política de ${label} debe ser una de: any, owner, faccion, rolepriest.`);
    }
  }

  const fields = [];
  const values = [];

  if (updates.fuelItemName !== undefined) {
    const fuelItemId = await _resolveFuelItemId(updates.fuelItemName);
    fields.push('fuel_item_id = ?');
    values.push(fuelItemId);
  }
  if (updates.fuelConsumptionRate !== undefined) {
    fields.push('fuel_consumption_rate = ?');
    values.push(updates.fuelConsumptionRate);
  }
  if (updates.fuelCapacity !== undefined) {
    fields.push('fuel_capacity = ?');
    values.push(updates.fuelCapacity);
  }

  if (updates.maintenanceItemName !== undefined) {
    const maintenanceItemId = await _resolveMaintenanceItemId(updates.maintenanceItemName);
    fields.push('maintenance_item_id = ?');
    values.push(maintenanceItemId);
  }
  if (updates.maintenanceRate !== undefined) {
    fields.push('maintenance_rate = ?');
    values.push(updates.maintenanceRate);
  }
  if (updates.durabilityRepairToolItemName !== undefined) {
    await _validateDurabilityRepairToolName(updates.durabilityRepairToolItemName);
    fields.push('durability_repair_tool_item_name = ?');
    values.push(updates.durabilityRepairToolItemName);
  }

  if (updates.isLandingSite !== undefined) {
    fields.push('is_landing_site = ?');
    values.push(updates.isLandingSite ? 1 : 0);
  }

  if (updates.isMarket !== undefined) {
    fields.push('is_market = ?');
    values.push(updates.isMarket ? 1 : 0);
  }

  if (updates.isRecruitmentOffice !== undefined) {
    fields.push('is_recruitment_office = ?');
    values.push(updates.isRecruitmentOffice ? 1 : 0);
  }

  if (updates.isResourceSilo !== undefined) {
    fields.push('is_resource_silo = ?');
    values.push(updates.isResourceSilo ? 1 : 0);
  }

  if (updates.travelCostMultiplier !== undefined) {
    if (typeof updates.travelCostMultiplier !== 'number' || updates.travelCostMultiplier <= 0 || updates.travelCostMultiplier > 1) {
      throw new Error('`ruta_multiplicador` debe ser un número mayor que 0 y menor o igual que 1 (ej: 0.5 = la mitad de coste).');
    }
    fields.push('travel_cost_multiplier = ?');
    values.push(updates.travelCostMultiplier);
  }

  if (updates.unlocksItemName !== undefined) {
    let unlocksRecipeId = null;
    if (updates.unlocksItemName !== null) {
      const recipe = await queryOne(SQL.getRecipeForItem, [updates.unlocksItemName.toLowerCase().trim()]);
      if (!recipe) {
        throw new Error(`El ítem "${updates.unlocksItemName}" no tiene ninguna receta de crafteo. Créala primero con \`/item receta\`.`);
      }
      unlocksRecipeId = recipe.id;
    }
    fields.push('unlocks_recipe_id = ?');
    values.push(unlocksRecipeId);
  }

  if (updates.grantsResourceItemName !== undefined) {
    let grantsResourceItemId = null;
    if (updates.grantsResourceItemName !== null) {
      const item = await queryOne(SQL.getItemByName, [updates.grantsResourceItemName.toLowerCase().trim()]);
      if (!item) throw new Error(`El ítem "${updates.grantsResourceItemName}" no existe en el catálogo.`);
      grantsResourceItemId = item.id;
    }
    fields.push('grants_resource_item_id = ?');
    values.push(grantsResourceItemId);
  }

  if (updates.grantsResourceRate !== undefined) {
    fields.push('grants_resource_rate = ?');
    values.push(updates.grantsResourceRate);
  }

  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(name);
  await execute(`UPDATE ${T.construction_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[ConstructionTypes] Tipo "${name}" actualizado: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [name]);
}

export async function deleteConstructionType(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de construcción llamado \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countInstances, [existing.id]);
  if (cnt > 0) {
    throw new Error(`No se puede eliminar \`${name}\`: hay **${cnt}** construcción(es) ya levantada(s) de este tipo.`);
  }

  await withTransaction(async () => {
    await execute(SQL.deleteIngredients, [existing.id]);
    await execute(SQL.delete, [name]);
  });

  logger.info(`[ConstructionTypes] Tipo eliminado: "${name}"`);
  return existing;
}

export async function updateConstructionTypeIngredients(name, ingredients = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de construcción llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteIngredients, [existing.id]);
    for (const { name: ingName, quantity } of ingredients) {
      const ingItem = await queryOne(SQL.getItemByName, [ingName.toLowerCase().trim()]);
      if (!ingItem) {
        throw new Error(`El ítem de ingrediente \`${ingName}\` no existe en el catálogo.`);
      }
      if (!(quantity > 0)) {
        throw new Error(`Cantidad inválida para el ingrediente \`${ingName}\`: debe ser un número positivo.`);
      }
      await execute(SQL.insertIngredient, [existing.id, ingItem.id, quantity]);
    }
  });

  logger.info(`[ConstructionTypes] Ingredientes de "${name}" reemplazados (${ingredients.length} ingrediente(s))`);
  return query(SQL.getIngredients, [existing.id]);
}

export async function configureConstructionUse(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ningún tipo de construcción llamado \`${name}\`.`);

  const fields = [];
  const values = [];

  if (updates.toolItemName !== undefined) {
    if (updates.toolItemName === 'laburo') {
      throw new Error('El Laburo no puede usarse como herramienta — usa un ítem normal.');
    }
    if (updates.toolItemName !== null) {
      const tool = await queryOne(SQL.getItemByName, [updates.toolItemName.toLowerCase().trim()]);
      if (!tool) throw new Error(`El ítem \`${updates.toolItemName}\` (herramienta) no existe en el catálogo.`);
    }
    fields.push('use_tool_item_name = ?');
    values.push(updates.toolItemName);
  }

  if (updates.resultItemName !== undefined) {
    if (updates.resultItemName === 'laburo') {
      throw new Error('El Laburo no puede ser el resultado de usar una construcción — no hay ningún caso de uso previsto para esto.');
    }
    const resultItem = await queryOne(SQL.getItemByName, [updates.resultItemName.toLowerCase().trim()]);
    if (!resultItem) throw new Error(`El ítem \`${updates.resultItemName}\` (resultado) no existe en el catálogo.`);
    fields.push('use_result_item_id = ?');
    values.push(resultItem.id);
  }

  const rollKeys = ['roll1', 'roll2', 'roll3', 'roll4', 'roll5', 'roll6'];
  rollKeys.forEach((key, i) => {
    if (updates[key] === undefined) return;
    fields.push(`use_roll_${i + 1} = ?`);
    values.push(updates[key]);
  });

  if (updates.laburoCost !== undefined) {
    fields.push('use_laburo_cost = ?');
    values.push(updates.laburoCost);
  }

  if (updates.cooldownHours !== undefined) {
    fields.push('use_cooldown_hours = ?');
    values.push(updates.cooldownHours);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para configurar (herramienta, resultado, dado_N, coste o cooldown).');
  }

  values.push(existing.name);
  await execute(`UPDATE ${T.construction_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[ConstructionTypes] Interacción de "${existing.name}" configurada: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [existing.name]);
}

export async function getItemById(itemId) {
  return (await queryOne(SQL.getItemById, [itemId])) ?? null;
}

export async function getUnlocksItemName(unlocksRecipeId) {
  if (unlocksRecipeId == null) return null;
  return (await queryOne(SQL.getRecipeResultItemName, [unlocksRecipeId]))?.name ?? null;
}

export const MAX_CONSTRUCTION_HEALTH = 1000;

export const TILE_CONSTRUCTION_LIMITS = {
  perTile: 15,
  perTypePerTile: 8,
};

export async function buildConstruction(discordId, x, y, constructionType) {
  const { total, ofType } = await countConstructionsAtTile(x, y, constructionType.id);

  if (total >= TILE_CONSTRUCTION_LIMITS.perTile) {
    throw new UserFacingError(
      `Esta casilla ya tiene **${total}** construcciones, el máximo por casilla (**${TILE_CONSTRUCTION_LIMITS.perTile}**). ` +
      `Destruye alguna con \`/build destroy\` antes de levantar otra.`
    );
  }

  if (ofType >= TILE_CONSTRUCTION_LIMITS.perTypePerTile) {
    throw new UserFacingError(
      `Esta casilla ya tiene **${ofType}** construcciones de tipo **${constructionType.display_name}**, ` +
      `el máximo del mismo tipo en una casilla (**${TILE_CONSTRUCTION_LIMITS.perTypePerTile}**).`
    );
  }

  const ingredients = await getIngredients(constructionType.id);
  const missing = [];

  for (const ing of ingredients) {
    const have = await getItemQuantity(discordId, ing.name);
    if (have < ing.quantity_required) {
      missing.push(`${ing.emoji ?? '📦'} **${ing.display_name}**: necesitas **${ing.quantity_required}**, tienes **${have}**`);
    }
  }
  if (constructionType.laburo_cost > 0) {
    const haveLaburo = await getAvailableLaburo(discordId);
    if (haveLaburo < constructionType.laburo_cost) {
      missing.push(`💪 **Laburo**: necesitas **${constructionType.laburo_cost}**, tienes **${haveLaburo.toFixed(2)}**`);
    }
  }
  if (missing.length > 0) {
    throw new UserFacingError(`Materiales insuficientes:\n${missing.join('\n')}`);
  }

  return withTransaction(async () => {
    for (const ing of ingredients) {
      if (ing.name === 'laburo') {
        throw new UserFacingError(
          'Este tipo de construcción tiene el Laburo mal configurado como ingrediente normal en vez de como coste — avisa a Staff (`/construction modify` para corregirlo).'
        );
      }
      await removeItem(discordId, ing.name, ing.quantity_required);
    }
    if (constructionType.laburo_cost > 0) {
      await spendLaburo(discordId, constructionType.laburo_cost);
    }
    return await placeConstructionInstance(x, y, constructionType, discordId);
  });
}
