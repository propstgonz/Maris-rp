CREATE TABLE pending_robberies (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    attacker_player_id  INT NOT NULL,
    target_player_id    INT NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fought', 'surrendered', 'expired')),
    channel_id          VARCHAR(191) DEFAULT NULL,
    message_id          VARCHAR(191) DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME DEFAULT NULL,
    FOREIGN KEY (attacker_player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (target_player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_robberies_status ON pending_robberies(status);
