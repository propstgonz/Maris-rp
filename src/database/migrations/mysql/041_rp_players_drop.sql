SET @sql = (SELECT CONCAT('ALTER TABLE players ', GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'players' AND REFERENCED_TABLE_NAME IN ('factions', 'faction_ranks'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS
    faction_rank_permissions, faction_ranks, faction_applications, faction_storage, permission_grants,
    player_effects, laburo_batches, pending_robberies, factions;

SET FOREIGN_KEY_CHECKS = 1;

SET SESSION group_concat_max_len = 1000000;
SET @drop_cols = (SELECT GROUP_CONCAT(COLUMN_NAME SEPARATOR '|') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'players' AND COLUMN_NAME NOT IN ('id', 'discord_id', 'username', 'character_name', 'avatar_filename', 'gender', 'age', 'race_id', 'menhir_id', 'menhir_chosen_at', 'stat_potencia', 'stat_intuicion', 'stat_chiripa', 'stat_autismo', 'stat_resistencia', 'stat_donjuanismo', 'stat_agilidad', 'stat_bonus_points', 'free_school_claimed_at', 'is_alive', 'died_at', 'character_created_at', 'character_reset_at', 'modmail_channel_id', 'created_at', 'updated_at'));
SET @sql = (SELECT CONCAT('ALTER TABLE players ', GROUP_CONCAT(CONCAT('DROP CHECK `', c.CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'players' AND t.CONSTRAINT_TYPE = 'CHECK' AND c.CHECK_CLAUSE REGEXP CONCAT('`(', @drop_cols, ')`'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql = (SELECT CONCAT('ALTER TABLE players ', GROUP_CONCAT(CONCAT('DROP COLUMN `', COLUMN_NAME, '`') SEPARATOR ', ')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'players' AND COLUMN_NAME NOT IN ('id', 'discord_id', 'username', 'character_name', 'avatar_filename', 'gender', 'age', 'race_id', 'menhir_id', 'menhir_chosen_at', 'stat_potencia', 'stat_intuicion', 'stat_chiripa', 'stat_autismo', 'stat_resistencia', 'stat_donjuanismo', 'stat_agilidad', 'stat_bonus_points', 'free_school_claimed_at', 'is_alive', 'died_at', 'character_created_at', 'character_reset_at', 'modmail_channel_id', 'created_at', 'updated_at'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE players MODIFY updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
