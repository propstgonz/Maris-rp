RENAME TABLE nations TO factions;
RENAME TABLE nation_applications TO faction_applications;
ALTER TABLE players CHANGE COLUMN nation_id faction_id INT DEFAULT NULL;
ALTER TABLE players RENAME INDEX idx_players_nation TO idx_players_faction;
ALTER TABLE faction_applications CHANGE COLUMN nation_id faction_id INT NOT NULL;
ALTER TABLE faction_applications RENAME INDEX idx_nation_applications_nation TO idx_faction_applications_faction;
ALTER TABLE faction_applications RENAME INDEX idx_nation_applications_pending TO idx_faction_applications_pending;
