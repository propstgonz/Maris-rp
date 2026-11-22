import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { getItemByName, getItemById } from './itemService.js';

const SQL = {
  insertRecipe: `
    INSERT INTO ${T.recipes} (result_item_id, result_quantity, laburo_cost, required_construction_type, tool_item_id, tool_laburo_reduction)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  insertIngredient: `
    INSERT INTO ${T.recipe_ingredients} (recipe_id, ingredient_item_id, quantity_required)
    VALUES (?, ?, ?)
  `,

  getRecipesByResultItemId: `SELECT * FROM ${T.recipes} WHERE result_item_id = ? ORDER BY id ASC`,
  getRecipeById: `SELECT * FROM ${T.recipes} WHERE id = ?`,
  deleteRecipe: `DELETE FROM ${T.recipes} WHERE id = ?`,

  getIngredientsByRecipeId: `
    SELECT ri.quantity_required, i.name, i.display_name, i.emoji
    FROM ${T.recipe_ingredients} ri JOIN ${T.items} i ON ri.ingredient_item_id = i.id
    WHERE ri.recipe_id = ?
  `,
};

async function _insertRecipeWithIngredients(itemId, recipeData) {
  const recipeResult = await execute(SQL.insertRecipe, [
    itemId, recipeData.resultQty ?? 1, recipeData.laboroCost, recipeData.constructionType ?? null,
    recipeData.toolItemId ?? null, recipeData.toolLaburoReduction ?? null
  ]);
  const recipeId = recipeResult.lastInsertRowid;

  for (const { name, quantity } of recipeData.ingredients) {
    const ingItem = await getItemByName(name);
    if (!ingItem) {
      throw new Error(`El ítem de ingrediente \`${name}\` no existe en el catálogo. Créalo primero.`);
    }
    await execute(SQL.insertIngredient, [recipeId, ingItem.id, quantity]);
  }

  return recipeId;
}

export async function addRecipe(itemId, recipeData) {
  return withTransaction(() => _insertRecipeWithIngredients(itemId, recipeData));
}

export async function getRecipesForItem(itemId) {
  const recipes = await query(SQL.getRecipesByResultItemId, [itemId]);
  return Promise.all(recipes.map(async recipe => ({
    ...recipe,
    ingredients: await query(SQL.getIngredientsByRecipeId, [recipe.id]),
    tool: recipe.tool_item_id ? await getItemById(recipe.tool_item_id) : null,
  })));
}

export async function getRecipeById(recipeId) {
  return (await queryOne(SQL.getRecipeById, [recipeId])) ?? null;
}

export async function removeRecipe(recipeId) {
  const result = await execute(SQL.deleteRecipe, [recipeId]);
  return result.changes;
}
