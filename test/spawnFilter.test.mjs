import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSpawnChance } from '../src/utils/spawnFilter.js';

const bosque = { name: 'bosque', spawn_chance_override_percent: null };
const norte  = { name: 'norte',  spawn_chance_override_percent: null };

test('sin filtros devuelve la probabilidad general', () => {
  assert.equal(resolveSpawnChance(7, { terrainName: 'bosque', zoneName: 'norte' }), 7);
});

test('un terreno que no casa descarta al candidato', () => {
  const chance = resolveSpawnChance(7, { terrainRows: [bosque], terrainName: 'yermo' });
  assert.equal(chance, null);
});

test('una zona que no casa descarta al candidato', () => {
  const chance = resolveSpawnChance(7, { zoneRows: [norte], terrainName: 'bosque', zoneName: 'sur' });
  assert.equal(chance, null);
});

test('una casilla sin zona descarta a quien exige zona', () => {
  const chance = resolveSpawnChance(7, { zoneRows: [norte], terrainName: 'bosque', zoneName: null });
  assert.equal(chance, null);
});

test('los dos filtros deben pasar, no basta con uno', () => {
  assert.equal(
    resolveSpawnChance(7, { terrainRows: [bosque], zoneRows: [norte], terrainName: 'bosque', zoneName: 'sur' }),
    null
  );
  assert.equal(
    resolveSpawnChance(7, { terrainRows: [bosque], zoneRows: [norte], terrainName: 'yermo', zoneName: 'norte' }),
    null
  );
  assert.equal(
    resolveSpawnChance(7, { terrainRows: [bosque], zoneRows: [norte], terrainName: 'bosque', zoneName: 'norte' }),
    7
  );
});

test('el override del terreno pisa a la probabilidad general', () => {
  const rows = [{ name: 'bosque', spawn_chance_override_percent: 30 }];
  assert.equal(resolveSpawnChance(7, { terrainRows: rows, terrainName: 'bosque' }), 30);
});

test('el override de la zona manda sobre el del terreno', () => {
  const chance = resolveSpawnChance(7, {
    terrainRows: [{ name: 'bosque', spawn_chance_override_percent: 30 }],
    zoneRows:    [{ name: 'norte',  spawn_chance_override_percent: 55 }],
    terrainName: 'bosque', zoneName: 'norte',
  });
  assert.equal(chance, 55);
});

test('una zona sin override conserva el override del terreno', () => {
  const chance = resolveSpawnChance(7, {
    terrainRows: [{ name: 'bosque', spawn_chance_override_percent: 30 }],
    zoneRows:    [norte],
    terrainName: 'bosque', zoneName: 'norte',
  });
  assert.equal(chance, 30);
});

test('un override de 0 se respeta en vez de caer a la general', () => {
  const chance = resolveSpawnChance(7, {
    zoneRows: [{ name: 'norte', spawn_chance_override_percent: 0 }],
    terrainName: 'bosque', zoneName: 'norte',
  });
  assert.equal(chance, 0);
});
