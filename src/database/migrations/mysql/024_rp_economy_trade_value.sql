ALTER TABLE items
  ADD COLUMN trade_value DOUBLE NOT NULL DEFAULT 0 CHECK(trade_value >= 0);
