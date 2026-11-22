import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

let player = null;
let blocking = [];
let npc = null;
let npcType = null;
let counterattack = null;
let releasedPause = false;
const logActionCalls = [];

mock.module('../src/services/playerService.js', {
  namedExports: {
    getPlayerByDiscordId: async () => player,
    findPlayerById: async () => null,
  },
});
// npcEncounterService.js también importa mapService.js y zoneService.js, cuyo
// árbol real arrastra la mitad del juego (producción, laburo, efectos...).
// attemptFlee no usa ninguna de las dos — se sustituyen enteras para no
// tener que rellenar ese árbol completo solo para que el import no falle.
mock.module('../src/services/mapService.js', { namedExports: { getTile: async () => null } });
mock.module('../src/services/zoneService.js', { namedExports: { getZoneById: async () => null } });
mock.module('../src/services/npcService.js', {
  namedExports: {
    spawnWildNpc: async () => null,
    spawnWildNpcGroup: async () => [],
    getNpcAtTile: async () => null,
    resolveNpcDeath: async () => {},
    getBlockingEncounters: async () => blocking,
    getNpcById: async () => npc,
    removeNpc: async () => {},
    getWildNpcsEncounteredBy: async () => [],
    releaseEncounter: async () => false,
    releaseGroupEncounter: async () => 0,
    releaseEncountersAwayFromPlayer: async () => 0,
    countBlockingEncounters: async () => 0,
  },
});
mock.module('../src/services/npcTypeService.js', {
  namedExports: {
    listNpcTypes: async () => [],
    getTerrains: async () => [],
    getZones: async () => [],
    getNpcTypeById: async () => npcType,
  },
});
mock.module('../src/services/npcCombatService.js', {
  namedExports: { resolveNpcCounterattack: async () => counterattack },
});
mock.module('../src/services/travelService.js', {
  namedExports: { releaseEncounterPause: async () => releasedPause },
});
mock.module('../src/services/auditLogService.js', {
  namedExports: { logAction: (entry) => { logActionCalls.push(entry); } },
});
mock.module('../src/utils/combatNarrative.js', {
  namedExports: { combatPhrase: () => 'te golpea' },
});

const { attemptFlee } = await import('../src/services/npcEncounterService.js');

function reset() {
  player = { id: 1, discord_id: 'jugador', username: 'jugador#0001', character_name: 'Nix', travel_paused_by_npc_id: null };
  blocking = [];
  npc = null;
  npcType = null;
  counterattack = null;
  releasedPause = false;
  logActionCalls.length = 0;
}

const realRandom = Math.random;
test.after(() => { Math.random = realRandom; });

test('attemptFlee: sin encuentro bloqueante, nada que soltar', async () => {
  reset();
  const result = await attemptFlee(null, 'jugador', 'jugador#0001', 'web');
  assert.equal(result.blocked, false);
  assert.equal(result.freed, false);
});

test('attemptFlee: sin encuentro bloqueante pero con una pausa colgada, la libera', async () => {
  reset();
  player.travel_paused_by_npc_id = 99;
  releasedPause = true;
  const result = await attemptFlee(null, 'jugador', 'jugador#0001', 'web');
  assert.equal(result.blocked, false);
  assert.equal(result.freed, true);
});

test('attemptFlee: flee_chance_percent 100 siempre escapa, sin contraataque', async () => {
  reset();
  blocking = [{ id: 42 }];
  npc = { id: 42, npc_type_id: 7, type_display_name: 'Lobo', spawned_from_group_type_id: null, is_wild: 0 };
  npcType = { flee_chance_percent: 100 };
  Math.random = () => 0.999;

  const result = await attemptFlee({}, 'jugador', 'jugador#0001', 'web');

  assert.equal(result.blocked, true);
  assert.equal(result.success, true);
  assert.equal(result.freed, true);
  assert.equal(result.label, 'Lobo');
  assert.equal(logActionCalls.length, 0, 'una huida exitosa no dispara un contraataque, no hay nada que auditar');
});

test('attemptFlee: flee_chance_percent 0 nunca escapa, y el contraataque queda auditado con la fuente correcta', async () => {
  reset();
  blocking = [{ id: 42 }];
  npc = { id: 42, npc_type_id: 7, type_display_name: 'Lobo', spawned_from_group_type_id: null, is_wild: 0 };
  npcType = { flee_chance_percent: 0 };
  counterattack = { hit: true, damage: 3, playerHpAfter: 6, playerKilled: false, immortalitySaved: false, outcomeRoll: 4 };
  Math.random = () => 0.001;

  const result = await attemptFlee({}, 'jugador', 'jugador#0001', 'web');

  assert.equal(result.blocked, true);
  assert.equal(result.success, false);
  assert.equal(result.freed, false);
  assert.equal(result.label, 'Lobo');
  assert.equal(result.lines.length, 1);

  assert.equal(logActionCalls.length, 1);
  assert.equal(logActionCalls[0].source, 'web');
  assert.equal(logActionCalls[0].action, 'combat.npc_counterattack_hit');
});

test('attemptFlee: la fuente por defecto sigue siendo discord cuando no se especifica', async () => {
  reset();
  blocking = [{ id: 42 }];
  npc = { id: 42, npc_type_id: 7, type_display_name: 'Lobo', spawned_from_group_type_id: null, is_wild: 0 };
  npcType = { flee_chance_percent: 0 };
  counterattack = { hit: true, damage: 3, playerHpAfter: 6, playerKilled: false, immortalitySaved: false, outcomeRoll: 4 };
  Math.random = () => 0.001;

  await attemptFlee({}, 'jugador', 'jugador#0001');

  assert.equal(logActionCalls[0].source, 'discord');
});
