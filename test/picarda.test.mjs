import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS, effectiveStats, freePoints, magicPoints, validateAllocation, canChangeMenhir, menhirChangeAvailableAt,
} from '../src/domain/picarda.js';

const player = (stats = {}, extra = {}) => ({
  is_alive: 1,
  stat_bonus_points: 0,
  ...Object.fromEntries(STATS.map(s => [`stat_${s}`, stats[s] ?? 0])),
  ...extra,
});

const aldmer = { mod_autismo: 2, mod_resistencia: -1 };
const bosmer = { mod_potencia: -1, mod_intuicion: 1, mod_agilidad: 1 };
const menhirMago = { magic_bonus: 50 };
const menhirRitual = { magic_to_life: 1 };
const menhirAprendiz = { mod_autismo: 1 };

test('la estadística efectiva suma raza y menhir y puede salirse de 0..6', () => {
  const eff = effectiveStats(player({ autismo: 6 }), aldmer, menhirAprendiz);
  assert.equal(eff.autismo, 9);
  assert.equal(eff.resistencia, -1);
  assert.equal(effectiveStats(player(), bosmer, null).potencia, -1);
});

test('sin raza ni menhir la efectiva es la base', () => {
  assert.deepEqual(effectiveStats(player({ chiripa: 3 }), null, null), {
    potencia: 0, intuicion: 0, chiripa: 3, autismo: 0, resistencia: 0, donjuanismo: 0, agilidad: 0,
  });
});

test('puntos libres = 8 + bonus - gastados', () => {
  assert.equal(freePoints(player()), 8);
  assert.equal(freePoints(player({ potencia: 6, agilidad: 2 })), 0);
  assert.equal(freePoints(player({ potencia: 6, agilidad: 2 }, { stat_bonus_points: 1 })), 1);
});

test('Magia = 25 x Autismo efectivo, más el Menhir del Mago, y nunca negativa', () => {
  assert.deepEqual(magicPoints(effectiveStats(player({ autismo: 6 }), aldmer, null), null, aldmer), { magia: 200, vidaExtra: 0 });
  assert.deepEqual(magicPoints(effectiveStats(player({ autismo: 6 }), null, null), null), { magia: 150, vidaExtra: 0 });
  assert.deepEqual(magicPoints(effectiveStats(player({ autismo: 2 }), null, null), menhirMago), { magia: 100, vidaExtra: 0 });
  assert.deepEqual(magicPoints({ autismo: -1 }, null), { magia: 0, vidaExtra: 0 });
});

test('el Menhir del Aprendiz no rebasa el tope: Aldmer 200, humano 150, y el Mago suma aparte', () => {
  const eff = (race, menhir) => effectiveStats(player({ autismo: 6 }), race, menhir);
  assert.equal(magicPoints(eff(aldmer, menhirAprendiz), menhirAprendiz, aldmer).magia, 200);
  assert.equal(magicPoints(eff(null, menhirAprendiz), menhirAprendiz, null).magia, 150);
  assert.equal(magicPoints(eff(null, menhirMago), menhirMago, null).magia, 200);
});

test('el Menhir Ritual convierte toda la Magia en Vida dividiendo entre 100', () => {
  assert.deepEqual(magicPoints({ autismo: 2 }, menhirRitual), { magia: 0, vidaExtra: 0.5 });
});

test('validateAllocation respeta el máximo de 6 y los puntos libres', () => {
  assert.equal(validateAllocation(player(), 'potencia', 6), null);
  assert.match(validateAllocation(player({ potencia: 5 }), 'potencia', 2), /no puede pasar de 6/);
  assert.match(validateAllocation(player({ potencia: 6, agilidad: 2 }), 'chiripa', 1), /Solo te quedan 0/);
  assert.match(validateAllocation(player(), 'fuerza', 1), /no existe/);
  assert.match(validateAllocation(player(), 'potencia', 0), /al menos 1/);
  assert.match(validateAllocation(player(), 'potencia', 1.5), /enteros/);
  assert.match(validateAllocation(player({}, { is_alive: 0 }), 'potencia', 1), /vivo/);
});

test('el menhir solo se cambia a los 6 meses de elegirlo', () => {
  const chosen = player({}, { menhir_id: 3, menhir_chosen_at: '2026-01-15 10:00:00' });
  assert.equal(menhirChangeAvailableAt(chosen).toISOString(), '2026-07-15T10:00:00.000Z');
  assert.equal(canChangeMenhir(chosen, new Date('2026-07-15T09:59:59Z')), false);
  assert.equal(canChangeMenhir(chosen, new Date('2026-07-15T10:00:00Z')), true);
  assert.equal(canChangeMenhir(player(), new Date()), true);
});
