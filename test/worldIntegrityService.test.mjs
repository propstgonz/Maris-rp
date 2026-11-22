import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const routes = [];
function respondWhen(matcher, rows) { routes.push({ matcher, rows }); }

const fakeDb = {
  prepare: (sql) => ({
    all: () => {
      const route = routes.find(r => r.matcher(sql));
      return route ? route.rows : [];
    },
    get: () => undefined,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
  }),
};
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { runWorldIntegrityChecks } = await import('../src/services/worldIntegrityService.js');

test('dangling_item_ref detecta un generador de recursos colgante', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('tile_resource_generators') && sql.includes('g.tile_id'), [{ x: 5, y: 5 }]);

  const report = await runWorldIntegrityChecks();
  const finding = report.findings.find(f => f.rule === 'dangling_item_ref' && f.entity === 'tile');
  assert.ok(finding);
  assert.equal(finding.severity, 'error');
  assert.equal(finding.entityName, '5,5');
  assert.equal(report.counts.error, 1);
});

test('unobtainable_required_item cruza requeridos contra obtenibles y resuelve el nombre', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('tool_item_id') && sql.includes('npc_type_equipment'), [{ item_id: 42 }]);
  respondWhen(sql => sql.includes('result_item_id AS item_id') && sql.includes('npc_tool_grants_item_id'), [{ item_id: 99 }]);
  respondWhen(sql => sql.includes('WHERE id IN ('), [{ id: 42, name: 'plutonio', display_name: 'Plutonio' }]);

  const report = await runWorldIntegrityChecks();
  const finding = report.findings.find(f => f.rule === 'unobtainable_required_item');
  assert.ok(finding);
  assert.equal(finding.entityName, 'plutonio');
  assert.match(finding.message, /Plutonio/);
});

test('impossible_resource_requirement avisa (warning), no bloquea', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('requires_resource_type'),
    [{ name: 'plataforma_petrolifera', display_name: 'Plataforma petrolífera', requires_resource_type: 'petroleo' }]);

  const report = await runWorldIntegrityChecks();
  const finding = report.findings.find(f => f.rule === 'impossible_resource_requirement');
  assert.ok(finding);
  assert.equal(finding.severity, 'warning');
  assert.equal(report.counts.error, 0);
});

test('craft_cycle detecta el callejón sin salida a un nivel', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('cti.ingredient_item_id = r.result_item_id'),
    [{ result_item_name: 'ladrillo', result_item_display: 'Ladrillo', construction_display: 'Horno' }]);

  const report = await runWorldIntegrityChecks();
  const finding = report.findings.find(f => f.rule === 'craft_cycle');
  assert.ok(finding);
  assert.equal(finding.entity, 'recipe');
  assert.equal(finding.entityName, 'ladrillo');
});

test('terrain_without_resources es solo informativo', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('terrain_type_resources tr WHERE tr.terrain_type_id = tt.id'),
    [{ name: 'yermo', display_name: 'Yermo' }]);

  const report = await runWorldIntegrityChecks();
  const finding = report.findings.find(f => f.rule === 'terrain_without_resources');
  assert.ok(finding);
  assert.equal(finding.severity, 'info');
});

test('opts.scope filtra los hallazgos a una sola entidad', async () => {
  routes.length = 0;
  respondWhen(sql => sql.includes('requires_resource_type'), [
    { name: 'plataforma_petrolifera', display_name: 'Plataforma petrolífera', requires_resource_type: 'petroleo' },
    { name: 'refineria', display_name: 'Refinería', requires_resource_type: 'gas' },
  ]);

  const report = await runWorldIntegrityChecks({ scope: { entity: 'construction_type', entityName: 'refineria' } });
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].entityName, 'refineria');
});
