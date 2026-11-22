CREATE TABLE faction_storage (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    faction_id INT NOT NULL,
    item_id    INT NOT NULL,
    quantity   DOUBLE NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE CASCADE,
    UNIQUE KEY idx_faction_storage_item (faction_id, item_id)
);

-- Sin estas filas, resolvePermission no tiene ningún required_rank_order
-- que mirar para estas acciones (el scope 'faction' no tiene fallbackPolicy)
-- y deniega a todo el mundo salvo al dueño — una facción recién creada
-- dejaba a sus propios miembros sin poder usar su propio almacén.
-- Reclutar NPCs gasta el almacén compartido — exige Colíder (2) o
-- superior; depositar es de bajo riesgo (Miembro, 0); retirar saca
-- recursos de vuelta al inventario personal, pide algo más de confianza
-- (Veterano, 1). Todo configurable después vía /faccion permisos.
-- Backfill para facciones ya existentes, igual que 007 sembró sus rangos.
INSERT INTO faction_rank_permissions (faction_id, action, required_rank_order)
SELECT id, 'faction.npc_recruit', 2 FROM factions;
INSERT INTO faction_rank_permissions (faction_id, action, required_rank_order)
SELECT id, 'faction.storage_deposit', 0 FROM factions;
INSERT INTO faction_rank_permissions (faction_id, action, required_rank_order)
SELECT id, 'faction.storage_withdraw', 1 FROM factions;
