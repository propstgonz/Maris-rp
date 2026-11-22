CREATE TABLE item_categories (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(191) NOT NULL UNIQUE,
    display_name VARCHAR(191) NOT NULL,
    emoji        VARCHAR(32) DEFAULT '🏷️',
    description  TEXT DEFAULT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE items ADD COLUMN category_name VARCHAR(191) DEFAULT NULL;
