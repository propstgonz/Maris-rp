CREATE TABLE faction_ranks (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    faction_id    INT NOT NULL,
    name          VARCHAR(64) NOT NULL,
    display_name  VARCHAR(191) NOT NULL,
    emoji         VARCHAR(32) DEFAULT NULL,
    rank_order    INT NOT NULL,
    is_default    TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    is_leader     TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_leader IN (0, 1)),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE CASCADE,
    UNIQUE KEY idx_faction_ranks_order (faction_id, rank_order),
    UNIQUE KEY idx_faction_ranks_name (faction_id, name)
);

ALTER TABLE players ADD COLUMN faction_rank_id INT DEFAULT NULL;
ALTER TABLE players ADD FOREIGN KEY (faction_rank_id) REFERENCES faction_ranks(id) ON DELETE SET NULL;
CREATE INDEX idx_players_faction_rank ON players(faction_rank_id);

CREATE TABLE faction_rank_permissions (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    faction_id          INT NOT NULL,
    action              VARCHAR(64) NOT NULL,
    required_rank_order INT NOT NULL,
    FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE CASCADE,
    UNIQUE KEY idx_faction_rank_permissions_action (faction_id, action)
);

CREATE TABLE permission_grants (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    subject_player_id    INT NOT NULL,
    scope_type           VARCHAR(32) NOT NULL,
    scope_id             INT NOT NULL,
    action               VARCHAR(64) NOT NULL,
    granted_by_player_id INT NOT NULL,
    granted_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at           DATETIME DEFAULT NULL,
    FOREIGN KEY (subject_player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE KEY idx_permission_grants_unique (subject_player_id, scope_type, scope_id, action)
);
CREATE INDEX idx_permission_grants_expires ON permission_grants(expires_at);

INSERT INTO faction_ranks (faction_id, name, display_name, emoji, rank_order, is_default, is_leader)
SELECT id, 'miembro', 'Miembro', '🔹', 0, 1, 0 FROM factions;
INSERT INTO faction_ranks (faction_id, name, display_name, emoji, rank_order, is_default, is_leader)
SELECT id, 'veterano', 'Veterano', '🔸', 1, 0, 0 FROM factions;
INSERT INTO faction_ranks (faction_id, name, display_name, emoji, rank_order, is_default, is_leader)
SELECT id, 'colider', 'Colíder', '🔶', 2, 0, 0 FROM factions;
INSERT INTO faction_ranks (faction_id, name, display_name, emoji, rank_order, is_default, is_leader)
SELECT id, 'lider', 'Líder', '👑', 3, 0, 1 FROM factions;

UPDATE players p
JOIN factions f ON f.owner_player_id = p.id
JOIN faction_ranks fr ON fr.faction_id = f.id AND fr.is_leader = 1
SET p.faction_rank_id = fr.id;
