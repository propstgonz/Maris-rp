ALTER TABLE players
  ADD COLUMN alert_travel_step TINYINT(1) NOT NULL DEFAULT 0 CHECK (alert_travel_step IN (0, 1));
