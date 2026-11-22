import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { schemaForMigrationFile } from '../src/database/migrate.js';

const MIGRATIONS_DIR = new URL('../src/database/migrations/mysql/', import.meta.url);

test('cada migración real resuelve a un esquema por su nombre', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  assert.ok(files.length >= 41);
  for (const file of files) {
    assert.match(schemaForMigrationFile(file), /^rp_(players|world|economy|ops)$/, file);
  }
});

test('deduce el esquema de nombres conocidos', () => {
  assert.equal(schemaForMigrationFile('001_rp_players.sql'), 'rp_players');
  assert.equal(schemaForMigrationFile('002_rp_world.sql'), 'rp_world');
  assert.equal(schemaForMigrationFile('003_rp_economy.sql'), 'rp_economy');
  assert.equal(schemaForMigrationFile('004_rp_ops.sql'), 'rp_ops');
  assert.equal(schemaForMigrationFile('035_rp_players_profile.sql'), 'rp_players');
  assert.equal(schemaForMigrationFile('037_rp_world_properties.sql'), 'rp_world');
  assert.equal(schemaForMigrationFile('038_rp_economy_goods.sql'), 'rp_economy');
});

test('rechaza nombres que no casan', () => {
  for (const bad of [
    'schema.sql',
    '35_rp_players.sql',
    '035_players.sql',
    '035_rp_other.sql',
    '035_rp_playersX.sql',
    '035_rp_players_profile.txt',
    '035-rp_players.sql',
    'x035_rp_players.sql',
    '',
  ]) {
    assert.throws(() => schemaForMigrationFile(bad), /no válido/, bad);
  }
});
