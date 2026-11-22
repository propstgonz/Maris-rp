DROP TABLE IF EXISTS recipe_ingredients, recipes, effect_types, transactions, pending_trades, construction_market_listings;

SET SESSION group_concat_max_len = 1000000;
SET @drop_cols = (SELECT GROUP_CONCAT(COLUMN_NAME SEPARATOR '|') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME NOT IN ('id', 'name', 'display_name', 'description', 'emoji', 'category_id', 'is_active', 'created_at'));
SET @sql = (SELECT CONCAT('ALTER TABLE items ', GROUP_CONCAT(CONCAT('DROP CHECK `', c.CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'items' AND t.CONSTRAINT_TYPE = 'CHECK' AND c.CHECK_CLAUSE REGEXP CONCAT('`(', @drop_cols, ')`'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql = (SELECT CONCAT('ALTER TABLE items ', GROUP_CONCAT(CONCAT('DROP COLUMN `', COLUMN_NAME, '`') SEPARATOR ', ')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME NOT IN ('id', 'name', 'display_name', 'description', 'emoji', 'category_id', 'is_active', 'created_at'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
