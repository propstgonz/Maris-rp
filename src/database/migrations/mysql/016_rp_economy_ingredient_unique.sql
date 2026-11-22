UPDATE recipe_ingredients ri
JOIN (
  SELECT recipe_id, ingredient_item_id, MIN(id) AS keep_id, SUM(quantity_required) AS total_qty
  FROM recipe_ingredients
  GROUP BY recipe_id, ingredient_item_id
  HAVING COUNT(*) > 1
) dup ON ri.id = dup.keep_id
SET ri.quantity_required = dup.total_qty;

DELETE ri FROM recipe_ingredients ri
JOIN (
  SELECT recipe_id, ingredient_item_id, MIN(id) AS keep_id
  FROM recipe_ingredients
  GROUP BY recipe_id, ingredient_item_id
  HAVING COUNT(*) > 1
) dup ON ri.recipe_id = dup.recipe_id AND ri.ingredient_item_id = dup.ingredient_item_id AND ri.id <> dup.keep_id;

ALTER TABLE recipe_ingredients ADD UNIQUE KEY idx_recipe_ingredient_unique (recipe_id, ingredient_item_id);
