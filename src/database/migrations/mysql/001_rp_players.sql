CREATE TABLE nations (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(191) NOT NULL UNIQUE,
    display_name    VARCHAR(191) NOT NULL,
    emoji           VARCHAR(32) DEFAULT '🏳️',
    description     TEXT DEFAULT NULL,
    owner_player_id INT DEFAULT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE players (
    id                       INT PRIMARY KEY AUTO_INCREMENT,
    discord_id               VARCHAR(191) NOT NULL UNIQUE,
    username                 VARCHAR(191) NOT NULL,
    hp                       DOUBLE NOT NULL DEFAULT 10 CHECK(hp >= 0),
    hunger                   DOUBLE NOT NULL DEFAULT 10 CHECK(hunger >= 0),
    laburo_base              DOUBLE NOT NULL DEFAULT 1.0 CHECK(laburo_base >= 0),
    coord_x                  INT NOT NULL DEFAULT 0,
    coord_y                  INT NOT NULL DEFAULT 0,
    avatar_filename          VARCHAR(255) DEFAULT 'avatars/default.png',
    is_alive                 TINYINT(1) NOT NULL DEFAULT 1 CHECK(is_alive IN (0, 1)),
    character_created_at     DATETIME DEFAULT NULL,
    character_name           VARCHAR(191) DEFAULT NULL,
    full_name                VARCHAR(191) DEFAULT NULL,
    nationality              VARCHAR(191) DEFAULT NULL,
    died_at                  DATETIME DEFAULT NULL,
    modmail_channel_id       VARCHAR(191) DEFAULT NULL,
    character_reset_at       DATETIME DEFAULT NULL,
    last_laburo_at           DATETIME DEFAULT NULL,
    is_immortal              TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_immortal IN (0, 1)),
    nation_id                INT DEFAULT NULL,
    travel_dest_x            INT DEFAULT NULL,
    travel_dest_y            INT DEFAULT NULL,
    travel_next_tick_at      DATETIME DEFAULT NULL,
    travel_speed_multiplier  DOUBLE DEFAULT NULL,
    travel_paused_by_npc_id  INT DEFAULT NULL,
    last_attack_at           DATETIME DEFAULT NULL,
    attacks_today_count      INT NOT NULL DEFAULT 0,
    attacks_today_date       DATE DEFAULT NULL,
    last_structure_attack_at DATETIME DEFAULT NULL,
    alert_fuel_low               TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_fuel_low IN (0, 1)),
    alert_structure_attacked     TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_structure_attacked IN (0, 1)),
    alert_citizenship_request    TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_citizenship_request IN (0, 1)),
    alert_laburo_expiring        TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_laburo_expiring IN (0, 1)),
    alert_player_attacked        TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_player_attacked IN (0, 1)),
    alert_revived                 TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_revived IN (0, 1)),
    alert_channel_to_dm           TINYINT(1) NOT NULL DEFAULT 1 CHECK(alert_channel_to_dm IN (0, 1)),
    inventory_capacity        DOUBLE NOT NULL DEFAULT 500 CHECK(inventory_capacity > 0),
    origin_country            VARCHAR(191) DEFAULT NULL,
    religion                  VARCHAR(191) DEFAULT NULL,
    description               TEXT DEFAULT NULL,
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (nation_id) REFERENCES nations(id) ON DELETE SET NULL
);

CREATE INDEX idx_players_position ON players(coord_x, coord_y);
CREATE INDEX idx_players_discord_id ON players(discord_id);
CREATE INDEX idx_players_traveling ON players(travel_next_tick_at);
CREATE INDEX idx_players_nation ON players(nation_id);

ALTER TABLE nations ADD FOREIGN KEY (owner_player_id) REFERENCES players(id) ON DELETE SET NULL;

CREATE TABLE character_registry (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    discord_id      VARCHAR(191) NOT NULL,
    character_name  VARCHAR(191) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_character_registry_did ON character_registry(discord_id);

CREATE TABLE player_effects (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    player_id           INT NOT NULL,
    effect_type         VARCHAR(191) NOT NULL,
    laburo_modifier     DOUBLE NOT NULL DEFAULT 0.0,
    hp_delta_per_day    DOUBLE NOT NULL DEFAULT 0.0,
    expires_at          DATETIME DEFAULT NULL,
    source_tile_id      INT DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_effects_player ON player_effects(player_id);
CREATE INDEX idx_effects_expires ON player_effects(expires_at);
CREATE INDEX idx_player_effects_source_tile ON player_effects(source_tile_id);
CREATE INDEX idx_player_effects_type ON player_effects(effect_type);

CREATE TABLE laburo_batches (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    player_id   INT NOT NULL,
    quantity    DOUBLE NOT NULL CHECK(quantity > 0),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_laburo_batches_player ON laburo_batches(player_id);
CREATE INDEX idx_laburo_batches_expires ON laburo_batches(expires_at);

CREATE TABLE newspapers (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    player_id           INT NOT NULL,
    item_id             INT DEFAULT NULL,
    discord_channel_id  VARCHAR(191) NOT NULL UNIQUE,
    channel_name        VARCHAR(191) NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_newspapers_player ON newspapers(player_id);

CREATE TABLE nation_applications (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    player_id    INT NOT NULL,
    nation_id    INT NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'denied', 'expired')),
    pending_key  INT DEFAULT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at  DATETIME DEFAULT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (nation_id) REFERENCES nations(id) ON DELETE CASCADE,
    UNIQUE KEY idx_nation_applications_pending (player_id, pending_key)
);

CREATE INDEX idx_nation_applications_nation ON nation_applications(nation_id);
