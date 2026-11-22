ALTER TABLE npcs
  ADD COLUMN encounter_notified_at DATETIME DEFAULT NULL;

UPDATE npcs SET encounter_notified_at = NOW()
WHERE encountered_by_player_id IS NOT NULL
  AND (encountered_channel_message_id IS NOT NULL OR encountered_dm_message_id IS NOT NULL);
