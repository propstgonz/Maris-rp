import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

let db, T, svc, alice, bob, carol, dead;

before(async () => {
  ({ db, T } = await resetDatabase());
  svc = await import('../../src/services/propertyService.js');
  alice = await createCharacter(db, T);
  bob = await createCharacter(db, T);
  carol = await createCharacter(db, T);
  dead = await createCharacter(db, T, { isAlive: false });
});

after(async () => { await db.closePool(); });

async function newType(displayName, category = 'vivienda') {
  return svc.createType({ displayName, category }, ACTOR);
}

test('catálogo: crear, duplicado, desactivar y no otorgar un tipo inactivo', async () => {
  const type = await newType('Casa Prueba');
  assert.equal(type.name, 'casa-prueba');
  await assert.rejects(() => newType('Casa Prueba'), /Ya existe/);
  await assert.rejects(() => svc.createType({ displayName: 'X', category: 'inventada' }, ACTOR), /categoría/);

  assert.ok((await svc.searchTypes('casa pru')).some(t => t.id === type.id));
  await svc.setTypeActive(type.id, false, ACTOR);
  assert.ok(!(await svc.listTypes()).some(t => t.id === type.id));
  assert.ok((await svc.listTypes({ includeInactive: true })).some(t => t.id === type.id));
  await assert.rejects(() => svc.grantProperty(alice.id, type.id, {}, ACTOR), /desactivado/);

  const edited = await svc.editType(type.id, { displayName: 'Casa Editada' }, ACTOR);
  assert.equal(edited.display_name, 'Casa Editada');
  assert.equal(edited.category, 'vivienda');
});

test('otorgar, listar paginado, nivel y revocar', async () => {
  const farm = await newType('Granja Prueba', 'ganaderia');
  const house = await newType('Vivienda Prueba', 'vivienda');
  for (let i = 0; i < 3; i++) {
    await svc.grantProperty(bob.id, house.id, { name: `Casa ${i}`, location: 'Hammerfell' }, ACTOR);
  }
  const f = await svc.grantProperty(bob.id, farm.id, { level: 2 }, ACTOR);

  await assert.rejects(() => svc.grantProperty(dead.id, house.id, {}, ACTOR), /muerto/);
  await assert.rejects(() => svc.grantProperty(bob.id, house.id, { level: 0 }, ACTOR), /nivel/);
  await assert.rejects(() => svc.grantProperty(bob.id, house.id, { location: 'x'.repeat(101) }, ACTOR), /ubicación/);

  const p1 = await svc.listProperties(bob.id, { page: 1, pageSize: 3 });
  const p2 = await svc.listProperties(bob.id, { page: 2, pageSize: 3 });
  assert.equal(p1.total, 4);
  assert.equal(p1.rows.length, 3);
  assert.equal(p2.rows.length, 1);
  assert.equal(p1.rows[0].category, 'ganaderia');

  assert.equal((await svc.setLevel(f.id, 5, ACTOR)).level, 5);
  await assert.rejects(() => svc.setLevel(f.id, 1001, ACTOR), /nivel/);

  const gone = await svc.revokeProperty(f.id, bob.id, ACTOR);
  assert.equal(gone.id, f.id);
  assert.equal(await svc.getProperty(f.id), null);
  await assert.rejects(() => svc.revokeProperty(f.id, bob.id, ACTOR), /no existe/);
});

test('traspaso: dueño equivocado y destino muerto fallan', async () => {
  const type = await newType('Traspaso Tipo');
  const prop = await svc.grantProperty(alice.id, type.id, {}, ACTOR);

  await assert.rejects(() => db.withTransaction(() => svc.transferPropertyInTx(bob.id, carol.id, prop.id)), /ya no es tuya/);
  await assert.rejects(() => db.withTransaction(() => svc.transferPropertyInTx(alice.id, dead.id, prop.id)), /muerto/);
  await assert.rejects(() => db.withTransaction(() => svc.transferPropertyInTx(alice.id, alice.id, prop.id)), /otro personaje/);
  assert.equal((await svc.getProperty(prop.id)).owner_player_id, alice.id);

  await db.withTransaction(() => svc.transferPropertyInTx(alice.id, bob.id, prop.id));
  assert.equal((await svc.getProperty(prop.id)).owner_player_id, bob.id);

  const moved = await svc.adminTransferProperty(prop.id, carol.id, ACTOR);
  assert.equal(moved.owner_player_id, carol.id);
});

test('carrera: la misma propiedad a B y a C a la vez, una sola gana', async () => {
  const type = await newType('Carrera Tipo');
  const prop = await svc.grantProperty(alice.id, type.id, {}, ACTOR);
  const results = await Promise.allSettled([
    db.withTransaction(() => svc.transferPropertyInTx(alice.id, bob.id, prop.id)),
    db.withTransaction(() => svc.transferPropertyInTx(alice.id, carol.id, prop.id)),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rows = await db.query(`SELECT owner_player_id FROM ${T.properties} WHERE id = ?`, [prop.id]);
  assert.equal(rows.length, 1);
  assert.ok([bob.id, carol.id].includes(rows[0].owner_player_id));
});

test('carrera: revocar y traspasar a la vez', async () => {
  const type = await newType('Carrera Revoca');
  const prop = await svc.grantProperty(alice.id, type.id, {}, ACTOR);
  const results = await Promise.allSettled([
    svc.revokeProperty(prop.id, alice.id, ACTOR),
    db.withTransaction(() => svc.transferPropertyInTx(alice.id, bob.id, prop.id)),
  ]);
  const rows = await db.query(`SELECT owner_player_id FROM ${T.properties} WHERE id = ?`, [prop.id]);
  if (rows.length === 0) {
    assert.equal(results[0].status, 'fulfilled');
  } else {
    assert.equal(rows[0].owner_player_id, bob.id);
    assert.equal(results[0].status, 'rejected');
  }
});

test('revocar con el dueño cambiado entre la confirmación y el borrado falla con un error claro', async () => {
  const type = await newType('Dueño Cambia');
  const prop = await svc.grantProperty(alice.id, type.id, {}, ACTOR);
  await svc.adminTransferProperty(prop.id, bob.id, ACTOR);
  await assert.rejects(() => svc.revokeProperty(prop.id, alice.id, ACTOR), /cambiado de dueño/);
  assert.equal((await svc.getProperty(prop.id)).owner_player_id, bob.id);
  assert.equal((await svc.revokeProperty(prop.id, bob.id, ACTOR)).id, prop.id);
});

test('searchTypes: activos por defecto, solo inactivos o todos', async () => {
  const active = await newType('Busqueda Activa');
  const inactive = await newType('Busqueda Inactiva');
  await svc.setTypeActive(inactive.id, false, ACTOR);
  const ids = rows => rows.map(r => r.id);
  assert.deepEqual(ids(await svc.searchTypes('Busqueda')), [active.id]);
  assert.deepEqual(ids(await svc.searchTypes('Busqueda', 25, { onlyInactive: true })), [inactive.id]);
  assert.deepEqual(ids(await svc.searchTypes('Busqueda', 25, { includeInactive: true })).sort(), [active.id, inactive.id].sort());
});
