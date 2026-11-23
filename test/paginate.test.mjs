import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalPages, clampPage, buildPaginationCtx, parsePaginationCtx, paginationRow, targetPage,
} from '../src/utils/paginate.js';

const OWNER = '1000141861333258393';

test('totalPages nunca baja de 1 y redondea hacia arriba', () => {
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(10), 1);
  assert.equal(totalPages(11), 2);
  assert.equal(totalPages(95), 10);
});

test('clampPage acota a [1, pages] y tolera basura', () => {
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(9, 5), 5);
  assert.equal(clampPage('abc', 5), 1);
});

test('el ctx se serializa y se parsea sin pérdida, con y sin filtro', () => {
  const ctx = buildPaginationCtx({ view: 'conjuros', page: 3, playerId: 42, extra: 'destruccion' });
  assert.equal(ctx, 'conjuros.3.42.destruccion');
  assert.deepEqual(parsePaginationCtx(ctx), { view: 'conjuros', page: 3, playerId: 42, extra: 'destruccion' });
  assert.deepEqual(parsePaginationCtx('npcs.1.7.-'), { view: 'npcs', page: 1, playerId: 7, extra: null });
  assert.equal(parsePaginationCtx('npcs.x.7'), null);
});

test('la fila lleva ◀ ▶ y "Página X/Y", con los extremos deshabilitados', () => {
  const first = paginationRow({ owner: OWNER, view: 'npcs', page: 1, pages: 3, playerId: 5 }).toJSON().components;
  assert.equal(first[0].disabled, true);
  assert.equal(first[1].label, 'Página 1/3');
  assert.equal(first[2].disabled, false);
  assert.ok(first.every(c => c.custom_id.length <= 100));

  const last = paginationRow({ owner: OWNER, view: 'npcs', page: 3, pages: 3, playerId: 5 }).toJSON().components;
  assert.equal(last[0].disabled, false);
  assert.equal(last[2].disabled, true);
  assert.match(last[0].custom_id, /^pag:prev:1000141861333258393:npcs\.3\.5\.-$/);
});

test('targetPage avanza, retrocede y se acota', () => {
  assert.equal(targetPage('next', 2, 5), 3);
  assert.equal(targetPage('next', 5, 5), 5);
  assert.equal(targetPage('prev', 1, 5), 1);
  assert.equal(targetPage('prev', 4, 5), 3);
});
