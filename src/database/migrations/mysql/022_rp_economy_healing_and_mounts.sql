ALTER TABLE items
  ADD COLUMN heal_range         INT NOT NULL DEFAULT 0 CHECK(heal_range >= 0),
  ADD COLUMN mount_hp_bonus     DOUBLE NOT NULL DEFAULT 0 CHECK(mount_hp_bonus >= 0),
  ADD COLUMN mount_damage_bonus DOUBLE NOT NULL DEFAULT 0 CHECK(mount_damage_bonus >= 0);
