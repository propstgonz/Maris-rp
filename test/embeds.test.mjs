import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileEmbed, buildNpcsEmbed, buildGoodsEmbed, buildPropertiesEmbed, buildSchoolsEmbed,
  buildSpellsEmbed, formatCost, formatNumber, schoolFormula,
} from '../src/utils/embeds.js';
import { STATS } from '../src/domain/picarda.js';

const zero = Object.fromEntries(STATS.map(s => [s, 0]));

function profile(overrides = {}) {
  const base = { ...zero, potencia: 3, autismo: 4 };
  return {
    player: { character_name: 'Muza', gender: 'mujer', age: 30, character_created_at: '2026-01-02 10:00:00', avatar_filename: null },
    race: { name: 'Orsimer', traits: 'Piel de piedra' },
    menhir: { name: 'El Menhir del Guerrero', description: '+ 1 de Potencia.' },
    base,
    effective: { ...base, potencia: 4, agilidad: -1 },
    freePoints: 2,
    menhirChangeAvailableAt: new Date(Date.now() + 86_400_000),
    civil: { label: 'Casada', spouse: { discordId: '123' } },
    ...overrides,
  };
}

function fields(embed) {
  return Object.fromEntries(embed.toJSON().fields.map(f => [f.name, f.value]));
}

test('perfil: solo cabecera y cuatro apartados, con modificador negativo de raza', () => {
  const json = buildProfileEmbed(profile()).toJSON();
  assert.equal(json.fields.length, 4);
  const f = fields(buildProfileEmbed(profile()));
  assert.match(f['📊 Estadísticas'], /Agilidad\*\* · base 0 · mod -1 · total \*\*-1\*\*/);
  assert.match(f['📊 Estadísticas'], /Potencia\*\* · base 3 · mod \+1 · total \*\*4\*\*/);
  assert.match(f['📊 Estadísticas'], /Puntos libres: \*\*2\*\*/);
  assert.match(f['🧬 Raza'], /Piel de piedra/);
  assert.match(f['🗿 Menhir'], /\+ 1 de Potencia\./);
  assert.match(f['🗿 Menhir'], /Podrás cambiarlo a partir de/);
  assert.match(f['💍 Estado civil'], /Casada · con <@123>/);
  assert.match(json.description, /Mujer/);
});

test('perfil: sin menhir dice «Sin elegir» y con cambio disponible no avisa de fecha', () => {
  const f = fields(buildProfileEmbed(profile({ menhir: null, menhirChangeAvailableAt: null, civil: { label: 'Soltera', spouse: null } })));
  assert.equal(f['🗿 Menhir'], 'Sin elegir');
  assert.equal(f['💍 Estado civil'], 'Soltera');
  const past = fields(buildProfileEmbed(profile({ menhirChangeAvailableAt: new Date(Date.now() - 1000) })));
  assert.doesNotMatch(past['🗿 Menhir'], /Podrás cambiarlo/);
});

test('NPCs agrupados como «Nombre ×N»', () => {
  const json = buildNpcsEmbed({ rows: [{ name: 'Guardia', count: 3 }], total: 1, page: 1, pages: 1 }).toJSON();
  assert.match(json.description, /Guardia ×3/);
  assert.match(json.footer.text, /Página 1\/1/);
});

test('bienes por categoría y cantidades con coma decimal es-ES', () => {
  const json = buildGoodsEmbed({
    rows: [
      { category: 'Comida', display_name: 'Pan', emoji: '🍞', quantity: 1.5 },
      { category: 'Comida', display_name: 'Sal', emoji: null, quantity: 2 },
      { category: null, display_name: 'Piedra', emoji: null, quantity: 0.25 },
    ],
    total: 3, page: 1, pages: 1,
  }).toJSON();
  assert.match(json.description, /\*\*Comida\*\*\n🍞 Pan — 1,5\n📦 Sal — 2/);
  assert.match(json.description, /\*\*Sin categoría\*\*\n📦 Piedra — 0,25/);
  assert.equal(formatNumber(1234.5), '1234,5');
});

test('propiedades: tipo, nombre, nivel, ubicación e id', () => {
  const json = buildPropertiesEmbed({
    rows: [{ id: 9, type_display_name: 'Granja', name: 'La Vega', level: 2, location: 'Norte', emoji: null }],
    total: 1, page: 1, pages: 1,
  }).toJSON();
  assert.match(json.description, /🏠 \*\*Granja\*\* «La Vega» — nivel 2 · Norte · `#9`/);
});

test('escuelas: Encantamiento excluida, fórmulas, reintento y Magia convertida en Vida', () => {
  const school = (slug, name, divisor = 1, secondary = 'intuicion') => ({ slug, name, secondary_stat: secondary, secondary_divisor: divisor });
  const retry = new Date(Date.now() + 5 * 86_400_000);
  const overview = {
    schools: [
      { school: school('destruccion', 'Destrucción', 2, 'autismo'), rank: 1, levelName: 'Principiante', next: { rank: 2, name: 'Aprendiz', threshold: 19, requiresMentor: true }, retryAfter: retry, active: true },
      { school: school('alteracion', 'Alteración'), rank: 0, levelName: null, next: { rank: 3, name: 'Hábil', threshold: 20.5, requiresMentor: false }, retryAfter: null, active: true },
      { school: school('encantamiento', 'Encantamiento'), rank: 0, levelName: null, next: null, retryAfter: null, active: false },
    ],
    magic: { magia: 0, vidaExtra: 0.25 },
    canClaimFreeSchool: true,
  };
  const embed = buildSchoolsEmbed(overview);
  const f = fields(embed);
  assert.match(f['Destrucción'], /Nivel 1 · Principiante/);
  assert.match(f['Destrucción'], /D20 \+ Autismo \+ Autismo\/2: 19 o más · requiere mentor/);
  assert.match(f['Destrucción'], /Puede reintentar el <t:/);
  assert.match(f['Alteración'], /Sin iniciar/);
  assert.match(f['Alteración'], /D20 \+ Autismo \+ Intuición: más de 20/);
  assert.equal(f['Encantamiento'], 'Excluida hasta nuevo aviso');
  const json = embed.toJSON();
  assert.match(json.description, /\+0,25 de Vida/);
  assert.match(json.description, /Menhir Ritual/);
  assert.match(json.description, /escuela gratuita/);
  assert.equal(schoolFormula(school('x', 'X', 1, 'autismo')), 'D20 + Autismo + Autismo');
});

test('conjuros: coste en Magia y en Vida, agrupados por escuela y nivel, y variante bloqueada', () => {
  const rows = [
    { school: 'Restauración', levelName: 'Principiante', name: 'Sanar', cost_amount: 25, cost_resource: 'magia', description: 'Cura heridas.' },
    { school: 'Restauración', levelName: 'Principiante', name: 'Sacrificio', cost_amount: 0.25, cost_resource: 'vida', description: 'Paga con sangre.' },
  ];
  const json = buildSpellsEmbed({ rows, total: 2, page: 1, pages: 1 }).toJSON();
  assert.equal(json.description.match(/\*\*Restauración\*\* · Principiante/g).length, 1);
  assert.match(json.description, /25 de Magia/);
  assert.match(json.description, /0,25 de Vida/);
  const locked = buildSpellsEmbed({ rows, total: 2, page: 1, pages: 1, locked: true }).toJSON();
  assert.match(locked.description, /🔒 \*\*Sanar\*\*/);
  assert.equal(formatCost(0.25, 'vida'), '0,25 de Vida');
});

test('listas largas respetan el límite de descripción de Discord', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    school: 'Destrucción', levelName: 'Principiante', name: `Conjuro ${i}`, cost_amount: 25, cost_resource: 'magia', description: 'x'.repeat(2000),
  }));
  const json = buildSpellsEmbed({ rows, total: 10, page: 1, pages: 1 }).toJSON();
  assert.ok(json.description.length <= 4096);
});
