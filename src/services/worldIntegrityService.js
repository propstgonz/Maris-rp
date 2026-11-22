import { query } from '../database/index.js';
import { T } from '../database/tables.js';

async function checkDanglingItemRef() {
  const findings = [];

  const generatorRows = await query(`
    SELECT t.coord_x AS x, t.coord_y AS y
    FROM ${T.tile_resource_generators} g
    JOIN ${T.map_tiles} t ON g.tile_id = t.id
    LEFT JOIN ${T.items} i ON g.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of generatorRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `El generador de recursos en (${r.x}, ${r.y}) apunta a un ítem que ya no existe.`,
      hint: 'Bórralo o vuelve a asignarle un ítem con /map addgenerator.',
    });
  }

  const ctRows = await query(`
    SELECT ct.name, ct.display_name,
      (ct.grants_resource_item_id IS NOT NULL AND gi.id IS NULL) AS bad_grants,
      (ct.use_result_item_id IS NOT NULL AND ui.id IS NULL) AS bad_use,
      (ct.fuel_item_id IS NOT NULL AND fi.id IS NULL) AS bad_fuel,
      (ct.maintenance_item_id IS NOT NULL AND mi.id IS NULL) AS bad_maint
    FROM ${T.construction_types} ct
    LEFT JOIN ${T.items} gi ON ct.grants_resource_item_id = gi.id
    LEFT JOIN ${T.items} ui ON ct.use_result_item_id = ui.id
    LEFT JOIN ${T.items} fi ON ct.fuel_item_id = fi.id
    LEFT JOIN ${T.items} mi ON ct.maintenance_item_id = mi.id
    WHERE (ct.grants_resource_item_id IS NOT NULL AND gi.id IS NULL)
       OR (ct.use_result_item_id IS NOT NULL AND ui.id IS NULL)
       OR (ct.fuel_item_id IS NOT NULL AND fi.id IS NULL)
       OR (ct.maintenance_item_id IS NOT NULL AND mi.id IS NULL)
  `);
  const CT_FIELD_LABEL = { bad_grants: 'Produce (pasivo)', bad_use: 'Da al usarse', bad_fuel: 'Combustible', bad_maint: 'Mantenimiento' };
  for (const r of ctRows) {
    for (const [flag, label] of Object.entries(CT_FIELD_LABEL)) {
      if (!r[flag]) continue;
      findings.push({
        rule: 'dangling_item_ref', severity: 'error', entity: 'construction_type', entityName: r.name,
        message: `**${r.display_name}** tiene el campo "${label}" apuntando a un ítem que ya no existe en el catálogo.`,
        hint: 'Elige otro ítem o vacía el campo.',
      });
    }
  }

  const ctIngredientRows = await query(`
    SELECT DISTINCT ct.name, ct.display_name
    FROM ${T.construction_type_ingredients} cti
    JOIN ${T.construction_types} ct ON cti.construction_type_id = ct.id
    LEFT JOIN ${T.items} i ON cti.ingredient_item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of ctIngredientRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'construction_type', entityName: r.name,
      message: `**${r.display_name}** tiene un ingrediente de construcción que ya no existe en el catálogo.`,
      hint: 'Revisa la lista de ingredientes y quita o reemplaza esa fila.',
    });
  }

  const npcWeaponRows = await query(`
    SELECT nt.name, nt.display_name FROM ${T.npc_types} nt
    LEFT JOIN ${T.items} i ON nt.weapon_item_id = i.id
    WHERE nt.weapon_item_id IS NOT NULL AND i.id IS NULL
  `);
  for (const r of npcWeaponRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'npc_type', entityName: r.name,
      message: `**${r.display_name}** tiene un arma asignada que ya no existe en el catálogo.`,
    });
  }

  const npcDropRows = await query(`
    SELECT DISTINCT nt.name, nt.display_name FROM ${T.npc_type_drops} d
    JOIN ${T.npc_types} nt ON d.npc_type_id = nt.id
    LEFT JOIN ${T.items} i ON d.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of npcDropRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'npc_type', entityName: r.name,
      message: `**${r.display_name}** tiene un botín (drop) que ya no existe en el catálogo.`,
    });
  }

  const npcEquipmentRows = await query(`
    SELECT DISTINCT nt.name, nt.display_name FROM ${T.npc_type_equipment} e
    JOIN ${T.npc_types} nt ON e.npc_type_id = nt.id
    LEFT JOIN ${T.items} i ON e.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of npcEquipmentRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'npc_type', entityName: r.name,
      message: `**${r.display_name}** tiene equipo asignado que ya no existe en el catálogo.`,
    });
  }

  const npcInstanceRows = await query(`
    SELECT t.coord_x AS x, t.coord_y AS y FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    LEFT JOIN ${T.items} i ON n.equipped_tool_item_id = i.id
    WHERE n.equipped_tool_item_id IS NOT NULL AND i.id IS NULL
  `);
  for (const r of npcInstanceRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `El NPC en (${r.x}, ${r.y}) tiene equipada una herramienta que ya no existe.`,
    });
  }

  const tileItemRows = await query(`
    SELECT t.coord_x AS x, t.coord_y AS y FROM ${T.tile_items} ti
    JOIN ${T.map_tiles} t ON ti.tile_id = t.id
    LEFT JOIN ${T.items} i ON ti.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of tileItemRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `Hay un ítem tirado en (${r.x}, ${r.y}) que ya no existe en el catálogo.`,
    });
  }

  const constructionStorageRows = await query(`
    SELECT DISTINCT t.coord_x AS x, t.coord_y AS y FROM ${T.construction_storage} cs
    JOIN ${T.constructions} c ON cs.construction_id = c.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.items} i ON cs.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of constructionStorageRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `El almacén de una construcción en (${r.x}, ${r.y}) tiene un ítem que ya no existe.`,
    });
  }

  const npcStorageRows = await query(`
    SELECT DISTINCT t.coord_x AS x, t.coord_y AS y FROM ${T.npc_storage} ns
    JOIN ${T.npcs} n ON ns.npc_id = n.id
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    LEFT JOIN ${T.items} i ON ns.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of npcStorageRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `El almacén de un NPC en (${r.x}, ${r.y}) tiene un ítem que ya no existe.`,
    });
  }

  const terrainResourceRows = await query(`
    SELECT DISTINCT tt.name, tt.display_name FROM ${T.terrain_type_resources} tr
    JOIN ${T.terrain_types} tt ON tr.terrain_type_id = tt.id
    LEFT JOIN ${T.items} i ON tr.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of terrainResourceRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'terrain_type', entityName: r.name,
      message: `**${r.display_name}** tiene un recurso recolectable que ya no existe en el catálogo.`,
    });
  }

  const zoneResourceRows = await query(`
    SELECT DISTINCT z.name, z.display_name FROM ${T.zone_resources} zr
    JOIN ${T.zones} z ON zr.zone_id = z.id
    LEFT JOIN ${T.items} i ON zr.item_id = i.id
    WHERE i.id IS NULL
  `);
  for (const r of zoneResourceRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'zone', entityName: r.name,
      message: `La zona **${r.display_name}** tiene un recurso recolectable que ya no existe en el catálogo.`,
    });
  }

  const npcToolGrantRows = await query(`
    SELECT i.name, i.display_name FROM ${T.items} i
    LEFT JOIN ${T.items} gi ON i.npc_tool_grants_item_id = gi.id
    WHERE i.npc_tool_grants_item_id IS NOT NULL AND gi.id IS NULL
  `);
  for (const r of npcToolGrantRows) {
    findings.push({
      rule: 'dangling_item_ref', severity: 'error', entity: 'item', entityName: r.name,
      message: `**${r.display_name}** otorga a un NPC trabajador un ítem que ya no existe.`,
    });
  }

  return findings;
}

async function checkDanglingItemNameRef() {
  const findings = [];

  const ctRows = await query(`
    SELECT ct.name, ct.display_name,
      (ct.use_tool_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} i WHERE i.name = ct.use_tool_item_name)) AS bad_use_tool,
      (ct.durability_repair_tool_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} i WHERE i.name = ct.durability_repair_tool_item_name)) AS bad_repair_tool
    FROM ${T.construction_types} ct
    WHERE (ct.use_tool_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} i WHERE i.name = ct.use_tool_item_name))
       OR (ct.durability_repair_tool_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} i WHERE i.name = ct.durability_repair_tool_item_name))
  `);
  for (const r of ctRows) {
    if (r.bad_use_tool) {
      findings.push({
        rule: 'dangling_item_name_ref', severity: 'error', entity: 'construction_type', entityName: r.name,
        message: `**${r.display_name}** exige una herramienta ("${r.use_tool_item_name ?? ''}") que ya no existe en el catálogo.`,
      });
    }
    if (r.bad_repair_tool) {
      findings.push({
        rule: 'dangling_item_name_ref', severity: 'error', entity: 'construction_type', entityName: r.name,
        message: `**${r.display_name}** exige una herramienta de reparación que ya no existe en el catálogo.`,
      });
    }
  }

  const recipeRows = await query(`
    SELECT r.id, ri.name AS result_item_name, ri.display_name AS result_item_display, r.required_construction_type
    FROM ${T.recipes} r
    JOIN ${T.items} ri ON r.result_item_id = ri.id
    WHERE r.required_construction_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${T.construction_types} ct WHERE ct.name = r.required_construction_type)
  `);
  for (const r of recipeRows) {
    findings.push({
      rule: 'dangling_item_name_ref', severity: 'error', entity: 'recipe', entityName: r.result_item_name,
      message: `La receta de **${r.result_item_display}** exige una construcción ("${r.required_construction_type}") que ya no existe en el catálogo.`,
    });
  }

  const itemRows = await query(`
    SELECT i.name, i.display_name,
      (i.weapon_ammo_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} a WHERE a.name = i.weapon_ammo_item_name)) AS bad_ammo,
      (i.consume_effect IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.effect_types} e WHERE e.name = i.consume_effect)) AS bad_consume_effect,
      (i.weapon_area_effect IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.effect_types} e WHERE e.name = i.weapon_area_effect)) AS bad_area_effect
    FROM ${T.items} i
    WHERE (i.weapon_ammo_item_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.items} a WHERE a.name = i.weapon_ammo_item_name))
       OR (i.consume_effect IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.effect_types} e WHERE e.name = i.consume_effect))
       OR (i.weapon_area_effect IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${T.effect_types} e WHERE e.name = i.weapon_area_effect))
  `);
  for (const r of itemRows) {
    if (r.bad_ammo) {
      findings.push({
        rule: 'dangling_item_name_ref', severity: 'error', entity: 'item', entityName: r.name,
        message: `**${r.display_name}** usa una munición que ya no existe en el catálogo.`,
      });
    }
    if (r.bad_consume_effect) {
      findings.push({
        rule: 'dangling_item_name_ref', severity: 'error', entity: 'item', entityName: r.name,
        message: `**${r.display_name}** aplica al consumirse un efecto que ya no existe.`,
      });
    }
    if (r.bad_area_effect) {
      findings.push({
        rule: 'dangling_item_name_ref', severity: 'error', entity: 'item', entityName: r.name,
        message: `**${r.display_name}** aplica en área un efecto que ya no existe.`,
      });
    }
  }

  return findings;
}

async function checkDanglingRecipeRef() {
  const findings = [];

  const ctRows = await query(`
    SELECT ct.name, ct.display_name FROM ${T.construction_types} ct
    WHERE ct.unlocks_recipe_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${T.recipes} r WHERE r.id = ct.unlocks_recipe_id)
  `);
  for (const r of ctRows) {
    findings.push({
      rule: 'dangling_recipe_ref', severity: 'error', entity: 'construction_type', entityName: r.name,
      message: `**${r.display_name}** desbloquea una receta que ya no existe.`,
    });
  }

  const constructionRows = await query(`
    SELECT DISTINCT t.coord_x AS x, t.coord_y AS y FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    WHERE c.unlocks_recipe_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${T.recipes} r WHERE r.id = c.unlocks_recipe_id)
  `);
  for (const r of constructionRows) {
    findings.push({
      rule: 'dangling_recipe_ref', severity: 'error', entity: 'tile', entityName: `${r.x},${r.y}`,
      message: `Una construcción en (${r.x}, ${r.y}) desbloquea una receta que ya no existe.`,
    });
  }

  return findings;
}

async function checkUnobtainableRequiredItem() {
  const requiredRows = await query(`
    SELECT item_id FROM (
      SELECT ingredient_item_id AS item_id FROM ${T.recipe_ingredients}
      UNION SELECT tool_item_id FROM ${T.recipes} WHERE tool_item_id IS NOT NULL
      UNION SELECT ingredient_item_id FROM ${T.construction_type_ingredients}
      UNION SELECT fuel_item_id FROM ${T.construction_types} WHERE fuel_item_id IS NOT NULL
      UNION SELECT maintenance_item_id FROM ${T.construction_types} WHERE maintenance_item_id IS NOT NULL
      UNION SELECT weapon_item_id FROM ${T.npc_types} WHERE weapon_item_id IS NOT NULL
      UNION SELECT item_id FROM ${T.npc_type_equipment}
      UNION SELECT i.id AS item_id FROM ${T.items} i JOIN ${T.construction_types} ct ON ct.use_tool_item_name = i.name
      UNION SELECT i.id AS item_id FROM ${T.items} i JOIN ${T.construction_types} ct ON ct.durability_repair_tool_item_name = i.name
      UNION SELECT a.id AS item_id FROM ${T.items} a JOIN ${T.items} w ON w.weapon_ammo_item_name = a.name
    ) required
  `);
  const obtainableRows = await query(`
    SELECT item_id FROM (
      SELECT result_item_id AS item_id FROM ${T.recipes}
      UNION SELECT item_id FROM ${T.npc_type_drops}
      UNION SELECT item_id FROM ${T.tile_resource_generators}
      UNION SELECT item_id FROM ${T.terrain_type_resources}
      UNION SELECT item_id FROM ${T.zone_resources}
      UNION SELECT use_result_item_id AS item_id FROM ${T.construction_types} WHERE use_result_item_id IS NOT NULL
      UNION SELECT grants_resource_item_id AS item_id FROM ${T.construction_types} WHERE grants_resource_item_id IS NOT NULL
      UNION SELECT npc_tool_grants_item_id AS item_id FROM ${T.items} WHERE npc_tool_grants_item_id IS NOT NULL
    ) obtainable
  `);

  const obtainableIds = new Set(obtainableRows.map(r => r.item_id));
  const unobtainableIds = [...new Set(requiredRows.map(r => r.item_id))].filter(id => !obtainableIds.has(id));
  if (unobtainableIds.length === 0) return [];

  const items = await query(
    `SELECT id, name, display_name FROM ${T.items} WHERE id IN (${unobtainableIds.map(() => '?').join(',')})`,
    unobtainableIds
  );
  return items.map(i => ({
    rule: 'unobtainable_required_item', severity: 'error', entity: 'item', entityName: i.name,
    message: `**${i.display_name}** hace falta para algo del juego, pero no hay ninguna forma de conseguirlo (ni receta, ni botín de NPC, ni generador, ni recolección por terreno o zona, ni construcción que lo dé).`,
    hint: 'Añade una vía de obtención, o quita la dependencia que lo exige.',
  }));
}

async function checkImpossibleResourceRequirement() {
  const rows = await query(`
    SELECT ct.name, ct.display_name, ct.requires_resource_type
    FROM ${T.construction_types} ct
    WHERE ct.requires_resource_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${T.map_tiles} t WHERE t.resource_type = ct.requires_resource_type)
  `);
  return rows.map(r => ({
    rule: 'impossible_resource_requirement', severity: 'warning', entity: 'construction_type', entityName: r.name,
    message: `**${r.display_name}** solo se puede construir sobre "${r.requires_resource_type}", pero ninguna casilla del mapa tiene ese recurso ahora mismo.`,
    hint: 'Marca ese recurso en alguna casilla con /map edit, o cambia el requisito.',
  }));
}

async function checkUnreachableTerrain() {
  const rows = await query(`
    SELECT tt.name, tt.display_name, tt.requires_vehicle_category
    FROM ${T.terrain_types} tt
    WHERE tt.requires_vehicle_category IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${T.items} i WHERE i.item_type = 'vehiculo' AND i.vehicle_category = tt.requires_vehicle_category)
  `);
  return rows.map(r => ({
    rule: 'unreachable_terrain', severity: 'warning', entity: 'terrain_type', entityName: r.name,
    message: `**${r.display_name}** exige un vehículo "${r.requires_vehicle_category}", pero no hay ningún ítem de ese tipo en el catálogo — nadie puede llegar ahí.`,
    hint: 'Crea un vehículo de esa categoría, o quita el requisito del terreno.',
  }));
}

async function checkIncompleteConfig() {
  const rows = await query(`
    SELECT ct.name, ct.display_name,
      (ct.fuel_item_id IS NOT NULL AND ct.fuel_consumption_rate IS NULL) AS bad_fuel,
      (ct.maintenance_item_id IS NOT NULL AND ct.maintenance_rate IS NULL) AS bad_maint,
      (ct.grants_resource_item_id IS NOT NULL AND ct.grants_resource_rate IS NULL) AS bad_grants,
      (ct.use_result_item_id IS NOT NULL AND COALESCE(ct.use_roll_1,0)+COALESCE(ct.use_roll_2,0)+COALESCE(ct.use_roll_3,0)+COALESCE(ct.use_roll_4,0)+COALESCE(ct.use_roll_5,0)+COALESCE(ct.use_roll_6,0) = 0) AS bad_use_rolls,
      (ct.durability_repair_tool_item_name IS NOT NULL AND ct.durability_loss_per_day IS NULL) AS bad_durability
    FROM ${T.construction_types} ct
    WHERE (ct.fuel_item_id IS NOT NULL AND ct.fuel_consumption_rate IS NULL)
       OR (ct.maintenance_item_id IS NOT NULL AND ct.maintenance_rate IS NULL)
       OR (ct.grants_resource_item_id IS NOT NULL AND ct.grants_resource_rate IS NULL)
       OR (ct.use_result_item_id IS NOT NULL AND COALESCE(ct.use_roll_1,0)+COALESCE(ct.use_roll_2,0)+COALESCE(ct.use_roll_3,0)+COALESCE(ct.use_roll_4,0)+COALESCE(ct.use_roll_5,0)+COALESCE(ct.use_roll_6,0) = 0)
       OR (ct.durability_repair_tool_item_name IS NOT NULL AND ct.durability_loss_per_day IS NULL)
  `);
  const MESSAGES = {
    bad_fuel: r => `**${r.display_name}** tiene combustible asignado pero sin tasa de consumo — nunca gastará fuel.`,
    bad_maint: r => `**${r.display_name}** tiene mantenimiento asignado pero sin tasa — nunca pedirá mantenimiento.`,
    bad_grants: r => `**${r.display_name}** produce un ítem pero sin tasa de producción — nunca generará nada.`,
    bad_use_rolls: r => `**${r.display_name}** da un resultado al usarse, pero las 6 caras de la tirada están en 0 — nunca dará nada.`,
    bad_durability: r => `**${r.display_name}** tiene herramienta de reparación pero sin pérdida de durabilidad diaria configurada — nunca se degradará.`,
  };
  const findings = [];
  for (const r of rows) {
    for (const [flag, buildMessage] of Object.entries(MESSAGES)) {
      if (r[flag]) {
        findings.push({
          rule: 'incomplete_config', severity: 'warning', entity: 'construction_type', entityName: r.name,
          message: buildMessage(r),
        });
      }
    }
  }
  return findings;
}

async function checkFuelItemNotMarked() {
  const rows = await query(`
    SELECT ct.name, ct.display_name, i.display_name AS fuel_item_display
    FROM ${T.construction_types} ct
    JOIN ${T.items} i ON ct.fuel_item_id = i.id
    WHERE i.is_fuel = 0
  `);
  return rows.map(r => ({
    rule: 'fuel_item_not_marked', severity: 'warning', entity: 'construction_type', entityName: r.name,
    message: `**${r.display_name}** usa **${r.fuel_item_display}** como combustible, pero ese ítem no está marcado como "es combustible" en su ficha.`,
    hint: 'Marca "Es combustible" en la ficha de ese ítem para que sea coherente en el resto del juego.',
  }));
}

async function checkCraftCycle() {
  const rows = await query(`
    SELECT ri.name AS result_item_name, ri.display_name AS result_item_display,
           ct.display_name AS construction_display
    FROM ${T.recipes} r
    JOIN ${T.items} ri ON r.result_item_id = ri.id
    JOIN ${T.construction_types} ct ON ct.name = r.required_construction_type
    JOIN ${T.construction_type_ingredients} cti ON cti.construction_type_id = ct.id
    WHERE cti.ingredient_item_id = r.result_item_id
  `);
  return rows.map(r => ({
    rule: 'craft_cycle', severity: 'warning', entity: 'recipe', entityName: r.result_item_name,
    message: `La receta de **${r.result_item_display}** exige la construcción **${r.construction_display}**, pero esa construcción necesita **${r.result_item_display}** para construirse — nunca se podrá craftear la primera vez.`,
    hint: 'Da otra vía de obtener el ingrediente, o cambia el requisito de la receta.',
  }));
}

async function checkTerrainWithoutResources() {
  const rows = await query(`
    SELECT tt.name, tt.display_name FROM ${T.terrain_types} tt
    WHERE NOT EXISTS (SELECT 1 FROM ${T.terrain_type_resources} tr WHERE tr.terrain_type_id = tt.id)
  `);
  return rows.map(r => ({
    rule: 'terrain_without_resources', severity: 'info', entity: 'terrain_type', entityName: r.name,
    message: `**${r.display_name}** no tiene ningún recurso recolectable configurado — /recolectar solo dará algo ahí si la casilla pertenece a una zona que sí los tenga.`,
  }));
}

async function checkZoneWithoutTiles() {
  const rows = await query(`
    SELECT z.name, z.display_name FROM ${T.zones} z
    WHERE NOT EXISTS (SELECT 1 FROM ${T.map_tiles} t WHERE t.zone_id = z.id)
  `);
  return rows.map(r => ({
    rule: 'zone_without_tiles', severity: 'info', entity: 'zone', entityName: r.name,
    message: `La zona **${r.display_name}** no tiene ninguna casilla asignada — no afecta a nada del mapa todavía.`,
    hint: 'Asígnale un rectángulo desde el mapa de Staff o con /zona asignar.',
  }));
}

async function checkZoneWithoutContent() {
  const rows = await query(`
    SELECT z.name, z.display_name FROM ${T.zones} z
    WHERE NOT EXISTS (SELECT 1 FROM ${T.zone_resources} zr WHERE zr.zone_id = z.id)
      AND NOT EXISTS (SELECT 1 FROM ${T.npc_type_zones} ntz WHERE ntz.zone_id = z.id)
      AND NOT EXISTS (SELECT 1 FROM ${T.npc_group_type_zones} ngz WHERE ngz.zone_id = z.id)
  `);
  return rows.map(r => ({
    rule: 'zone_without_content', severity: 'info', entity: 'zone', entityName: r.name,
    message: `La zona **${r.display_name}** no aporta ni recursos propios ni NPCs propios — ahora mismo es solo un nombre.`,
    hint: 'Dale recursos recolectables, o marca algún tipo de NPC como exclusivo de esta zona.',
  }));
}

const RULES = [
  checkDanglingItemRef,
  checkDanglingItemNameRef,
  checkDanglingRecipeRef,
  checkUnobtainableRequiredItem,
  checkImpossibleResourceRequirement,
  checkUnreachableTerrain,
  checkIncompleteConfig,
  checkFuelItemNotMarked,
  checkCraftCycle,
  checkTerrainWithoutResources,
  checkZoneWithoutTiles,
  checkZoneWithoutContent,
];

export async function runWorldIntegrityChecks(opts = {}) {
  const results = await Promise.all(RULES.map(rule => rule()));
  let findings = results.flat();

  if (opts.scope) {
    findings = findings.filter(f => f.entity === opts.scope.entity && f.entityName === opts.scope.entityName);
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  return { findings, counts, generatedAt: new Date().toISOString() };
}
