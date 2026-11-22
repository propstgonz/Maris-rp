CREATE TABLE system_state (
    `key`   VARCHAR(191) PRIMARY KEY,
    value   TEXT NOT NULL
);

INSERT INTO system_state (`key`, value) VALUES
    ('last_daily_reset',  NOW()),
    ('last_weekly_reset', NOW());

CREATE TABLE terminal_jobs (
    id                       INT PRIMARY KEY AUTO_INCREMENT,
    command_line             TEXT NOT NULL,
    requested_by_discord_id  VARCHAR(191) NOT NULL,
    status                   VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'error')),
    result_text              TEXT DEFAULT NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at             DATETIME DEFAULT NULL
);

CREATE INDEX idx_terminal_jobs_status ON terminal_jobs(status);

CREATE TABLE bot_jobs (
    id                       INT PRIMARY KEY AUTO_INCREMENT,
    job_type                 VARCHAR(191) NOT NULL,
    payload                  TEXT NOT NULL,
    requested_by_discord_id  VARCHAR(191) NOT NULL,
    status                   VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'error')),
    result_text              TEXT DEFAULT NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at             DATETIME DEFAULT NULL
);

CREATE INDEX idx_bot_jobs_status ON bot_jobs(status);

CREATE TABLE audit_log (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    source            VARCHAR(16) NOT NULL CHECK(source IN ('web','discord')),
    actor_discord_id  VARCHAR(191) NOT NULL,
    actor_username    VARCHAR(191) NOT NULL,
    action            VARCHAR(191) NOT NULL,
    target            TEXT DEFAULT NULL,
    details           TEXT DEFAULT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_discord_id);
CREATE INDEX idx_audit_log_action ON audit_log (action);

CREATE TABLE web_sessions (
    sid         VARCHAR(191) PRIMARY KEY,
    session     TEXT NOT NULL,
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_web_sessions_expires ON web_sessions(expires_at);

CREATE TABLE modmail_categories (
    id                    INT PRIMARY KEY AUTO_INCREMENT,
    discord_category_id   VARCHAR(191) NOT NULL UNIQUE,
    display_name          VARCHAR(191) DEFAULT NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
