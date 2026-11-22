



























import { query, queryOne, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { CONSTRUCTION_ALIVE_SQL } from '../utils/sql.js';
import { addItem, removeItem, hasEnough } from './inventoryService.js';
import { getAvailableLaburo, spendLaburo } from './laburoService.js';
import { createNewspaperChannel } from './newspaperService.js';


export class RecipeChoiceNeededError extends Error {
  constructor(itemDisplayName, candidates) {
    super(`Hay varias recetas de "${itemDisplayName}" que puedes permitirte — elige una.`);
    this.name = 'RecipeChoiceNeededError';
    this.candidates = candidates;
  }
}


const SQL = {

  getPlayer: `
    SELECT id, discord_id, username, character_name, coord_x, coord_y, is_alive
    FROM ${T.players} WHERE discord_id = ?
  `,

  getRecipesForItem: `
    SELECT
      r.id,
      r.result_quantity,
      r.laburo_cost,
      r.required_construction_type,
      r.tool_item_id,
      r.tool_laburo_reduction,
      i.name            AS result_name,
      i.display_name    AS result_display_name,
      i.emoji           AS result_emoji,
      i.image_filename  AS result_image_filename,
      i.triggers_newspaper_channel AS result_triggers_newspaper,
      ti.name           AS tool_item_name,
      ti.display_name   AS tool_item_display,
      ti.emoji          AS tool_item_emoji
    FROM ${T.recipes} r
    JOIN ${T.items} i ON r.result_item_id = i.id
    LEFT JOIN ${T.items} ti ON r.tool_item_id = ti.id
    WHERE i.name = ?
    ORDER BY r.id ASC
  `,

  getRecipeById: `
    SELECT
      r.id,
      r.result_quantity,
      r.laburo_cost,
      r.required_construction_type,
      r.tool_item_id,
      r.tool_laburo_reduction,
      i.name            AS result_name,
      i.display_name    AS result_display_name,
      i.emoji           AS result_emoji,
      i.image_filename  AS result_image_filename,
      i.triggers_newspaper_channel AS result_triggers_newspaper,
      ti.name           AS tool_item_name,
      ti.display_name   AS tool_item_display,
      ti.emoji          AS tool_item_emoji
    FROM ${T.recipes} r
    JOIN ${T.items} i ON r.result_item_id = i.id
    LEFT JOIN ${T.items} ti ON r.tool_item_id = ti.id
    WHERE r.id = ?
  `,

  getAllRecipes: `
    SELECT
      r.id,
      r.result_quantity,
      r.laburo_cost,
      r.required_construction_type,
      r.tool_item_id,
      r.tool_laburo_reduction,
      i.name            AS result_name,
      i.display_name    AS result_display_name,
      i.emoji           AS result_emoji,
      i.image_filename  AS result_image_filename,
      i.triggers_newspaper_channel AS result_triggers_newspaper,
      ti.name           AS tool_item_name,
      ti.display_name   AS tool_item_display,
      ti.emoji          AS tool_item_emoji
    FROM ${T.recipes} r
    JOIN ${T.items} i ON r.result_item_id = i.id
    LEFT JOIN ${T.items} ti ON r.tool_item_id = ti.id
    ORDER BY i.display_name ASC, r.id ASC
  `,

  getIngredients: `
    SELECT
      ri.quantity_required,
      i.name,
      i.display_name,
      i.emoji
    FROM ${T.recipe_ingredients} ri
    JOIN ${T.items} i ON ri.ingredient_item_id = i.id
    WHERE ri.recipe_id = ?
  `,

  getTileAt: `
    SELECT id, name FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?
  `,

  checkConstruction: `
    SELECT COUNT(*) AS cnt
    FROM ${T.constructions} c
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE c.tile_id = ? AND (c.construction_type = ? OR ct.name = ?)
      AND (${CONSTRUCTION_ALIVE_SQL})
  `,

  getQty: `
    SELECT inv.quantity
    FROM ${T.inventory} inv
    JOIN ${T.items} i ON inv.item_id = i.id
    WHERE inv.player_id = ? AND i.name = ?
  `,
};



async function _executeCraft(discordId, ingredients, resultName, resultQty, laboroCost) {
  return withTransaction(async () => {
    for (const { name, quantity_required } of ingredients) {





      if (name === 'laburo') {
        throw new Error(
          'Esta receta tiene el Laburo mal configurado como ingrediente normal en vez de como coste — avisa a Staff (`/item modify` para corregirla).'
        );
      }
      await removeItem(discordId, name, quantity_required);
    }
    if (laboroCost > 0) {


      await spendLaburo(discordId, laboroCost);
    }
    await addItem(discordId, resultName, resultQty);
  });
}


async function _evaluateRecipe(player, recipe) {
  const ingredients = await query(SQL.getIngredients, [recipe.id]);
  const missing = [];
  let constructionOk = true;
  let constructionError = null;

  if (recipe.required_construction_type) {
    const tile = await queryOne(SQL.getTileAt, [player.coord_x, player.coord_y]);
    if (!tile) {
      constructionOk = false;
      constructionError =
        `necesitas estar en una casilla con **${recipe.required_construction_type}**, pero la casilla ` +
        `(${player.coord_x}, ${player.coord_y}) no existe en el mapa todavía`;
    } else {
      const { cnt } = await queryOne(SQL.checkConstruction, [tile.id, recipe.required_construction_type, recipe.required_construction_type]);
      if (cnt === 0) {
        constructionOk = false;
        constructionError =
          `necesitas estar en una casilla con **${recipe.required_construction_type}** — la casilla actual ` +
          `**${tile.name}** (${player.coord_x}, ${player.coord_y}) no la tiene`;
      }
    }
  }

  for (const ing of ingredients) {
    const row  = await queryOne(SQL.getQty, [player.id, ing.name]);
    const have = row?.quantity ?? 0;
    if (have < ing.quantity_required) {
      missing.push(
        `${ing.emoji ?? '📦'} **${ing.display_name}**: ` +
        `necesitas **${ing.quantity_required}**, tienes **${have}**`
      );
    }
  }




  const hasTool = Boolean(recipe.tool_item_id) && (await hasEnough(player.discord_id, recipe.tool_item_name, 1));
  const laburoReduction = hasTool ? (recipe.tool_laburo_reduction ?? 0) : 0;
  const effectiveLaburoCost = Math.max(0, recipe.laburo_cost - laburoReduction);

  if (effectiveLaburoCost > 0) {
    const haveLaburo = await getAvailableLaburo(player.discord_id);
    if (haveLaburo < effectiveLaburoCost) {
      missing.push(
        `💪 **Laburo**: necesitas **${effectiveLaburoCost}**, tienes **${haveLaburo.toFixed(2)}**`
      );
    }
  }

  return {
    recipe, ingredients, missing, constructionOk, constructionError,
    hasTool, laburoReduction, effectiveLaburoCost,
    usable: missing.length === 0 && constructionOk,
  };
}




export async function craftItem(discordId, itemName, guild = null, recipeId = null) {


  const player = await queryOne(SQL.getPlayer, [discordId]);
  if (!player) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!player.is_alive) throw new Error('No puedes craftear si tu personaje está muerto.');


  let chosen;

  if (recipeId !== null) {


    chosen = await queryOne(SQL.getRecipeById, [recipeId]);
    if (!chosen) {
      throw new Error('Esa receta ya no existe (puede que Staff la haya quitado mientras tanto) — vuelve a intentar `/craft`.');
    }
  } else {
    const allRecipes = await query(SQL.getRecipesForItem, [itemName.toLowerCase().trim()]);
    if (allRecipes.length === 0) {
      throw new Error(
        `No existe receta para **${itemName}**. ` +
        `El Staff puede crearla con \`/item receta\`.`
      );
    }

    if (allRecipes.length === 1) {
      chosen = allRecipes[0];
    } else {
      const evaluations = await Promise.all(allRecipes.map(r => _evaluateRecipe(player, r)));
      const usable = evaluations.filter(e => e.usable);

      if (usable.length === 1) {
        chosen = usable[0].recipe;
      } else if (usable.length > 1) {
        throw new RecipeChoiceNeededError(allRecipes[0].result_display_name, usable);
      } else {
        const lines = evaluations.map((ev, i) => {
          const reason = !ev.constructionOk ? ev.constructionError : ev.missing.join(', ');
          return `**Receta #${i + 1}**: ${reason}`;
        });
        throw new Error(`No puedes permitirte ninguna receta de **${itemName}**:\n${lines.join('\n')}`);
      }
    }
  }


  const finalEval = await _evaluateRecipe(player, chosen);
  if (!finalEval.constructionOk) {
    throw new Error(`Para craftear **${chosen.result_display_name}** ${finalEval.constructionError}.`);
  }
  if (finalEval.missing.length > 0) {
    throw new Error(`Materiales insuficientes:\n${finalEval.missing.join('\n')}`);
  }
  const ingredients = finalEval.ingredients;




  await _executeCraft(
    discordId,
    ingredients,
    chosen.result_name,
    chosen.result_quantity,
    finalEval.effectiveLaburoCost
  );

  logger.info(
    `[Craft] ${player.username} crafteó x${chosen.result_quantity} ` +
    `"${chosen.result_display_name}" (receta #${chosen.id}) en (${player.coord_x},${player.coord_y})` +
    (finalEval.hasTool ? ` [herramienta ${chosen.tool_item_name}: -${finalEval.laburoReduction} Laburo]` : '')
  );





  if (chosen.result_triggers_newspaper && guild) {
    createNewspaperChannel(guild, player, { name: chosen.result_name })
      .catch(err => logger.warn(`[Craft] No se pudo crear el canal de periódico de ${player.username}: ${err.message}`));
  }

  return {
    player,
    recipe: chosen,
    ingredients,
    laburoCost: finalEval.effectiveLaburoCost,
    laburoReduction: finalEval.laburoReduction,
    toolUsed: finalEval.hasTool
      ? { name: chosen.tool_item_name, display_name: chosen.tool_item_display, emoji: chosen.tool_item_emoji }
      : null,
    result: {
      name:           chosen.result_name,
      display_name:   chosen.result_display_name,
      emoji:          chosen.result_emoji ?? '📦',
      quantity:       chosen.result_quantity,
      image_filename: chosen.result_image_filename,
    },
  };
}


export async function listCraftableForPlayer(discordId) {
  const player = await queryOne(SQL.getPlayer, [discordId]);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!player.is_alive) throw new UserFacingError('No puedes craftear si tu personaje está muerto.');

  const allRecipes = await query(SQL.getAllRecipes);
  const evaluations = await Promise.all(allRecipes.map(recipe => _evaluateRecipe(player, recipe)));
  return evaluations.filter(ev => ev.usable);
}
