ALTER TABLE items
    ADD COLUMN category_id INT DEFAULT NULL,
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1,
    ADD CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES item_categories(id);

UPDATE items i
JOIN item_categories c ON c.name = i.category_name
SET i.category_id = c.id;

CREATE TEMPORARY TABLE type_category_map (
    item_type     VARCHAR(16) NOT NULL PRIMARY KEY,
    name          VARCHAR(191) NOT NULL,
    display_name  VARCHAR(191) NOT NULL
);

INSERT INTO type_category_map (item_type, name, display_name) VALUES
    ('dinero', 'moneda', 'Moneda'),
    ('recurso', 'recursos', 'Recursos'),
    ('herramienta', 'herramientas', 'Herramientas'),
    ('arma', 'armas', 'Armas'),
    ('consumible', 'consumibles', 'Consumibles'),
    ('vehiculo', 'vehiculos', 'Vehículos'),
    ('laburo', 'laburo', 'Laburo');

INSERT IGNORE INTO item_categories (name, display_name)
SELECT m.name, m.display_name
FROM type_category_map m
WHERE EXISTS (SELECT 1 FROM items i WHERE i.item_type = m.item_type AND i.category_id IS NULL);

UPDATE items i
JOIN type_category_map m ON m.item_type = i.item_type
JOIN item_categories c ON c.name = m.name
SET i.category_id = c.id
WHERE i.category_id IS NULL;

DROP TEMPORARY TABLE type_category_map;

DELETE FROM inventory WHERE quantity <= 0;

SET @sql = (SELECT CONCAT('ALTER TABLE inventory ', GROUP_CONCAT(CONCAT('DROP CHECK `', c.CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'inventory' AND t.CONSTRAINT_TYPE = 'CHECK');
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE inventory
    MODIFY quantity DECIMAL(14,2) NOT NULL,
    DROP COLUMN durability,
    DROP COLUMN slot_position;

DELETE FROM inventory WHERE quantity <= 0;

ALTER TABLE inventory ADD CONSTRAINT chk_inventory_quantity_positive CHECK (quantity > 0);
