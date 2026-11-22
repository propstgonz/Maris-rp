UPDATE construction_type_ingredients cti
JOIN (
  SELECT construction_type_id, ingredient_item_id, MIN(id) AS keep_id, SUM(quantity_required) AS total_qty
  FROM construction_type_ingredients
  GROUP BY construction_type_id, ingredient_item_id
  HAVING COUNT(*) > 1
) dup ON cti.id = dup.keep_id
SET cti.quantity_required = dup.total_qty;

DELETE cti FROM construction_type_ingredients cti
JOIN (
  SELECT construction_type_id, ingredient_item_id, MIN(id) AS keep_id
  FROM construction_type_ingredients
  GROUP BY construction_type_id, ingredient_item_id
  HAVING COUNT(*) > 1
) dup ON cti.construction_type_id = dup.construction_type_id AND cti.ingredient_item_id = dup.ingredient_item_id AND cti.id <> dup.keep_id;

ALTER TABLE construction_type_ingredients ADD UNIQUE KEY idx_construction_type_ingredient_unique (construction_type_id, ingredient_item_id);
