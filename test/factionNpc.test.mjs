import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
let factionRow = null;
const executed = [];

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    query: async () => [],
    queryOne: async (sql) => {
      if (/faction_applications/.test(sql)) return /status = 'pending'/.test(sql) ? null : { id: 7, status: 'pending' };
      return factionRow;
    },
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      return { changes: 1, lastInsertRowid: 7 };
    },
    withTransaction: async (fn) => fn(),
  },
});

const { createFaction, createApplication, setOwner } = await import('../src/services/factionService.js');

const npcFaction = { id: 1, name: 'legion', display_name: 'La Legión', is_npc: 1, owner_player_id: null };
const playerFaction = { id: 2, name: 'norte', display_name: 'El Norte', is_npc: 0, owner_player_id: null };

test('crear una facción NPC guarda la marca', async () => {
  factionRow = null;
  executed.length = 0;
  await createFaction({ name: 'Legion', displayName: 'La Legión', isNpc: true });
  const insert = executed.find(e => /INSERT INTO .*factions/.test(e.sql));
  assert.equal(insert.params.at(-1), 1);
});

test('una facción de jugadores se guarda sin la marca', async () => {
  factionRow = null;
  executed.length = 0;
  await createFaction({ name: 'norte', displayName: 'El Norte' });
  const insert = executed.find(e => /INSERT INTO .*factions/.test(e.sql));
  assert.equal(insert.params.at(-1), 0);
});

test('una facción NPC no admite solicitudes de ingreso', async () => {
  factionRow = npcFaction;
  executed.length = 0;
  await assert.rejects(() => createApplication(10, npcFaction.id), /no admite jugadores/);
  assert.equal(executed.length, 0);
});

test('una facción de jugadores sí admite solicitudes', async () => {
  factionRow = playerFaction;
  executed.length = 0;
  const application = await createApplication(10, playerFaction.id);
  assert.equal(application.id, 7);
});

test('una facción NPC no puede tener dueño', async () => {
  factionRow = npcFaction;
  executed.length = 0;
  await assert.rejects(() => setOwner('legion', '123456789012345678'), /no puede tener a un jugador al mando/);
  assert.equal(executed.length, 0);
});
