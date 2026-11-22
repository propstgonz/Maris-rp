ALTER TABLE players
  ADD COLUMN gender VARCHAR(16) DEFAULT NULL CHECK (gender IN ('hombre', 'mujer') OR gender IS NULL);
