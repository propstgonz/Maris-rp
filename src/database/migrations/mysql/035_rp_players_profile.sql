CREATE TABLE races (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    slug             VARCHAR(32) NOT NULL UNIQUE,
    name             VARCHAR(64) NOT NULL,
    description      TEXT NOT NULL,
    traits           TEXT DEFAULT NULL,
    mod_potencia     TINYINT NOT NULL DEFAULT 0,
    mod_intuicion    TINYINT NOT NULL DEFAULT 0,
    mod_chiripa      TINYINT NOT NULL DEFAULT 0,
    mod_autismo      TINYINT NOT NULL DEFAULT 0,
    mod_resistencia  TINYINT NOT NULL DEFAULT 0,
    mod_donjuanismo  TINYINT NOT NULL DEFAULT 0,
    mod_agilidad     TINYINT NOT NULL DEFAULT 0,
    sort             TINYINT NOT NULL
);

INSERT INTO races (slug, name, description, traits, mod_potencia, mod_intuicion, mod_chiripa, mod_autismo, mod_resistencia, mod_donjuanismo, mod_agilidad, sort) VALUES
    ('nordico', 'Nórdico', 'Los Hombres del Norte son personas recias y fuertes, con un carácter distinguible de entre los Mer y conocidos por ser descendientes directos de los primeros colonizadores de Tamriel junto a los 300 Compañeros Originales.', 'Resistencia Elemental al Hielo', 1, 0, 0, 0, 0, 0, 0, 1),
    ('imperial', 'Imperial', 'Los Originarios de Cyrodiil, la Provincia Imperial, se les conoce por su talante y su carisma, disfrutando de una versatilidad esencial para su supervivencia y para la prosperidad del Imperio.', NULL, 0, 0, 0, 0, 0, 1, 0, 2),
    ('breton', 'Bretón', 'Los Habitantes de Roca Alta son conocidos por su intelecto superior al promedio, por su cosmopolitismo y amiguismos con sus antecesores élficos y humanos… Se dice que cuando los Nórdicos vieron tales cruces entre razas huyeron horrorizados de Roca Alta.', 'Resistencia Mágica que divide a la mitad todo Daño Elemental', 0, 0, 0, 1, 0, 0, 0, 3),
    ('guardia_rojo', 'Guardia Rojo', 'Los Hombres de las Arenas son individuos extraordinarios, conocidos por su resistencia a los venenos, su piel oscura y su destreza natural… El Páramo de Martillo sin duda curtió al pueblo que mora allí desde hace eones.', 'Inmunidad a los Venenos', 0, 1, 0, 0, 0, 0, 0, 4),
    ('bosmer', 'Bosmer', 'Los Elfos de los Bosques son originarios de Bosque Valen, una región extremadamente frondosa y hogar de cientos de especies aún sin conocer… Por lo pronto sus habitantes son conocidos por ser unos cazadores excelentes, haciendo un uso excepcional del arco y del sigilo.', NULL, -1, 1, 0, 0, 0, 0, 1, 5),
    ('aldmer', 'Aldmer', 'Los Altos Elfos provienen de Estivalia y se proclaman así mismos como los hijos y herederos de los Divinos por lo general, enarbolando así una actitud e ideario colectivo complejo que navega entre el desdén, la superioridad y el sentimiento de guiar al resto de razas inferiores… Son pioneros en el entendimiento de la magia y versados en los campos de la ciencia, el arte y la teoría.', NULL, 0, 0, 0, 2, -1, 0, 0, 6),
    ('dunmer', 'Dunmer', 'Los Elfos Oscuros tan habituados a las llamas y a la ceniza son nativos de Morrowind y ejercen una influencia recalcable en los campos intelectuales y no tan honestos de todo el continente… Las diferentes Casas que gobiernan la sociedad dunmer son prueba de las ambiciones impulsadas por el cuchillo y el conjuro.', 'Resistencia Elemental al Fuego', -1, 1, 0, 1, 0, 0, 0, 7),
    ('orsimer', 'Orsimer', 'Los Orcos no tienen una provincia como tal a la cual llamar patria, solo su ciudad “capital” de Orsinium, sin embargo ello no les ha privado de sobrevivir en asentamientos ubicados en las montañas facilitando su aislamiento frente a lo que ocurriera en Tamriel… Conocidos por su irascibilidad y fuerza, los Orsimer han servido a la Legión Imperial incontables veces.', NULL, 1, -1, 0, 0, 2, 0, -1, 8),
    ('argoniano', 'Argoniano', 'Los Hombres Lagarto no tienen otra patria que la Ciénaga Negra / Argonia, donde se ubican sus árboles-madre, los Hist, guardianes de sus huevos y donde nacen las crías, estableciendo una conexión irrompible hasta uno de ellos perecer… Los Argonianos son ampliamente conocidos como mercenarios y pescadores, incluso apreciados en el mundo criminal.', 'Respiración subacuática', 0, 0, 0, 0, 0, 0, 1, 9),
    ('khajiita', 'Khajiita', 'Los Hombres Gato son individuos verdaderamente extraordinarios, relatados como guerreros atléticos y tan livianos que una vez impactados por las flechas estas simplemente atravesaban sus cuerpos y seguían aquellos guerreros avanzando… Hoy en día estos nativos de Elsweyr son famosos en todo lo relacionado a lo delictivo y al asesinato.', NULL, -1, 0, 0, 0, 0, 0, 2, 10);

CREATE TABLE menhirs (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    slug         VARCHAR(64) NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL,
    description  TEXT DEFAULT NULL,
    is_active    TINYINT(1) NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE players
    ADD COLUMN age                    SMALLINT DEFAULT NULL,
    ADD COLUMN race_id                INT DEFAULT NULL,
    ADD COLUMN menhir_id              INT DEFAULT NULL,
    ADD COLUMN stat_potencia          TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_intuicion         TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_chiripa           TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_autismo           TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_resistencia       TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_donjuanismo       TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_agilidad          TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN stat_bonus_points      TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN free_school_claimed_at DATETIME DEFAULT NULL,
    ADD CONSTRAINT chk_players_age CHECK (age IS NULL OR age BETWEEN 1 AND 1000),
    ADD CONSTRAINT chk_players_stat_potencia CHECK (stat_potencia BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_intuicion CHECK (stat_intuicion BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_chiripa CHECK (stat_chiripa BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_autismo CHECK (stat_autismo BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_resistencia CHECK (stat_resistencia BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_donjuanismo CHECK (stat_donjuanismo BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_agilidad CHECK (stat_agilidad BETWEEN 0 AND 6),
    ADD CONSTRAINT chk_players_stat_bonus_points CHECK (stat_bonus_points >= 0),
    ADD CONSTRAINT fk_players_race FOREIGN KEY (race_id) REFERENCES races(id),
    ADD CONSTRAINT fk_players_menhir FOREIGN KEY (menhir_id) REFERENCES menhirs(id);

CREATE TABLE player_npcs (
    id                     INT PRIMARY KEY AUTO_INCREMENT,
    owner_player_id        INT NOT NULL,
    name                   VARCHAR(80) NOT NULL,
    created_by_discord_id  VARCHAR(191) DEFAULT NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_owner_name (owner_player_id, name),
    CONSTRAINT fk_player_npcs_owner FOREIGN KEY (owner_player_id) REFERENCES players(id)
);

CREATE TABLE marriages (
    id                      INT PRIMARY KEY AUTO_INCREMENT,
    proposed_by_player_id   INT NOT NULL,
    accepted_by_player_id   INT NOT NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at                DATETIME DEFAULT NULL,
    end_reason              ENUM('divorcio','viudedad','anulacion') DEFAULT NULL,
    CONSTRAINT fk_marriages_proposed_by FOREIGN KEY (proposed_by_player_id) REFERENCES players(id),
    CONSTRAINT fk_marriages_accepted_by FOREIGN KEY (accepted_by_player_id) REFERENCES players(id)
);

CREATE TABLE marriage_members (
    marriage_id  INT NOT NULL,
    player_id    INT NOT NULL,
    open_slot    TINYINT DEFAULT NULL CHECK (open_slot IS NULL OR open_slot = 1),
    PRIMARY KEY (marriage_id, player_id),
    UNIQUE KEY uq_one_open_marriage (player_id, open_slot),
    CONSTRAINT fk_marriage_members_marriage FOREIGN KEY (marriage_id) REFERENCES marriages(id) ON DELETE CASCADE,
    CONSTRAINT fk_marriage_members_player FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE consent_requests (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    kind            ENUM('item','npc','property','marriage') NOT NULL,
    from_player_id  INT NOT NULL,
    to_player_id    INT NOT NULL,
    item_id         INT DEFAULT NULL,
    quantity        DECIMAL(14,2) DEFAULT NULL,
    npc_name        VARCHAR(80) DEFAULT NULL,
    npc_count       SMALLINT DEFAULT NULL,
    property_id     INT DEFAULT NULL,
    status          ENUM('pending','accepted','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      DATETIME NOT NULL,
    resolved_at     DATETIME DEFAULT NULL,
    KEY idx_to_status (to_player_id, status),
    KEY idx_from_status (from_player_id, status),
    CONSTRAINT fk_consent_requests_from FOREIGN KEY (from_player_id) REFERENCES players(id),
    CONSTRAINT fk_consent_requests_to FOREIGN KEY (to_player_id) REFERENCES players(id)
);

INSERT IGNORE INTO rp_ops.system_state (`key`, value) VALUES ('character_creation_cooldown_hours', '336');
