ALTER TABLE players
  ADD COLUMN alert_web_echo TINYINT(1) NOT NULL DEFAULT 1 CHECK (alert_web_echo IN (0, 1));
