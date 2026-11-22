import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, effectiveStats } from '../src/domain/picarda.js';
import {
  RETRY_DAYS, attemptModifier, isSuccess, mentorQualifies, canClaimFreeSchool,
} from '../src/domain/magic.js';

const SCHOOLS = {
  destruccion:   { secondary_stat: 'autismo', secondary_divisor: 2 },
  alteracion:    { secondary_stat: 'intuicion', secondary_divisor: 1 },
  restauracion:  { secondary_stat: 'resistencia', secondary_divisor: 1 },
  ilusion:       { secondary_stat: 'agilidad', secondary_divisor: 1 },
  conjuracion:   { secondary_stat: 'donjuanismo', secondary_divisor: 1 },
  encantamiento: { secondary_stat: 'potencia', secondary_divisor: 1 },
};

const eff = (stats = {}) => Object.fromEntries(STATS.map(s => [s, stats[s] ?? 0]));
const player = (stats = {}, extra = {}) => ({
  ...Object.fromEntries(STATS.map(s => [`stat_${s}`, stats[s] ?? 0])), ...extra,
});

test('el enfriamiento son 28 días', () => {
  assert.equal(RETRY_DAYS, 28);
});

test('modificador de las seis escuelas', () => {
  const e = eff({ autismo: 4, potencia: 1, intuicion: 2, chiripa: 9, resistencia: 3, donjuanismo: 5, agilidad: 6 });
  assert.equal(attemptModifier(e, SCHOOLS.destruccion), 6);
  assert.equal(attemptModifier(e, SCHOOLS.alteracion), 6);
  assert.equal(attemptModifier(e, SCHOOLS.restauracion), 7);
  assert.equal(attemptModifier(e, SCHOOLS.ilusion), 10);
  assert.equal(attemptModifier(e, SCHOOLS.conjuracion), 9);
  assert.equal(attemptModifier(e, SCHOOLS.encantamiento), 5);
});

test('Destrucción con Autismo impar da decimal sin redondear', () => {
  assert.equal(attemptModifier(eff({ autismo: 5 }), SCHOOLS.destruccion), 7.5);
  assert.equal(attemptModifier(eff({ autismo: 3 }), SCHOOLS.destruccion), 4.5);
});

test('éxito si total >= umbral, también con decimales', () => {
  assert.equal(isSuccess(21, 21), true);
  assert.equal(isSuccess(20, 21), false);
  assert.equal(isSuccess(18.5, 19), false);
  assert.equal(isSuccess(19.5, 19), true);
});

test('un mentor sirve con nivel igual o superior al objetivo', () => {
  assert.equal(mentorQualifies(3, 3), true);
  assert.equal(mentorQualifies(5, 2), true);
  assert.equal(mentorQualifies(2, 3), false);
  assert.equal(mentorQualifies(0, 2), false);
});

test('escuela gratuita: Aldmer 4+2 sí, Bosmer 5 no, con Menhir del Aprendiz sí, solo una vez', () => {
  const aldmer = { mod_autismo: 2 };
  const bosmer = { mod_potencia: -1, mod_intuicion: 1, mod_agilidad: 1 };
  const aprendiz = { mod_autismo: 1 };
  const libre = player({ autismo: 4 });
  assert.equal(canClaimFreeSchool(effectiveStats(libre, aldmer, null), libre), true);
  const b = player({ autismo: 5 });
  assert.equal(canClaimFreeSchool(effectiveStats(b, bosmer, null), b), false);
  assert.equal(canClaimFreeSchool(effectiveStats(b, bosmer, aprendiz), b), true);
  const usada = player({ autismo: 6 }, { free_school_claimed_at: new Date() });
  assert.equal(canClaimFreeSchool(effectiveStats(usada, null, null), usada), false);
});
