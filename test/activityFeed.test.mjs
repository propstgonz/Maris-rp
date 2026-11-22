import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeActivity, describeActivityForTarget } from '../src/services/activityFeed.js';

test('describeActivity: acción desconocida devuelve null', () => {
  assert.equal(describeActivity({ action: 'item.create', target: 'hierro', details: {} }), null);
});

test('describeActivity: combat.ranged_hit con muerte', () => {
  const text = describeActivity({
    action: 'combat.ranged_hit', target: 'discord123',
    details: { targetName: 'Fulano', damage: 12, killed: true },
  });
  assert.match(text, /matado a \*\*Fulano\*\*/);
  assert.match(text, /-12 HP/);
});

test('describeActivity: combat.melee_hit autolesión', () => {
  const text = describeActivity({
    action: 'combat.melee_hit', target: 'discord123',
    details: { selfInflicted: true, selfDamage: 3, attackerKilled: false },
  });
  assert.match(text, /te has hecho daño/);
  assert.match(text, /-3 HP/);
});

test('describeActivity: gather.attempt sin acierto', () => {
  const text = describeActivity({
    action: 'gather.attempt', target: '(4,5)',
    details: { hit: false },
  });
  assert.match(text, /No has conseguido nada/);
  assert.match(text, /\(4,5\)/);
});

test('describeActivity: craft.done', () => {
  const text = describeActivity({
    action: 'craft.done', target: 'espada de hierro',
    details: { quantity: 2 },
  });
  assert.equal(text, 'Has crafteado **2× espada de hierro**.');
});

test('describeActivity: details ausente no rompe la llamada', () => {
  const text = describeActivity({ action: 'travel.cancel', target: null, details: null });
  assert.equal(text, 'Has cancelado tu viaje.');
});

test('describeActivity: market.purchase', () => {
  const text = describeActivity({
    action: 'market.purchase', target: '(3,4)',
    details: { item: 'pan', quantity: 5, totalCost: 10 },
  });
  assert.equal(text, 'Has comprado **5× pan** en (3,4) por **10** de Laburo.');
});

test('describeActivity: tile.npc_recruit', () => {
  const text = describeActivity({
    action: 'tile.npc_recruit', target: '(1,1)',
    details: { npcType: 'lobo' },
  });
  assert.equal(text, 'Has reclutado un **lobo** en (1,1).');
});

test('describeActivity: player.robbery_proposed', () => {
  const text = describeActivity({
    action: 'player.robbery_proposed', target: 'discord456',
    details: { robberyId: 1, targetName: 'Fulano' },
  });
  assert.equal(text, 'Has propuesto saquear a **Fulano**.');
});

test('describeActivity: laburo.trade', () => {
  const text = describeActivity({
    action: 'laburo.trade', target: 'discord456',
    details: { toCharacterName: 'Fulano', quantity: 3 },
  });
  assert.equal(text, 'Le diste **3** de Laburo a **Fulano**.');
});

test('describeActivity: trade.propose', () => {
  const text = describeActivity({
    action: 'trade.propose', target: 'discord456',
    details: { toCharacterName: 'Fulano', item: 'pan', quantity: 2 },
  });
  assert.equal(text, 'Has propuesto darle **2× pan** a **Fulano**.');
});

test('describeActivity: empire.collect con producción', () => {
  const text = describeActivity({
    action: 'empire.collect', target: 'p1',
    details: { lines: ['Granja: +5 trigo', 'Mina: +2 hierro'] },
  });
  assert.equal(text, 'Has cobrado tu producción pendiente: Granja: +5 trigo · Mina: +2 hierro.');
});

test('describeActivity: empire.collect sin nada que cobrar', () => {
  const text = describeActivity({ action: 'empire.collect', target: 'p1', details: { lines: [] } });
  assert.equal(text, 'No tenías producción pendiente que cobrar.');
});

test('describeActivityForTarget: acción desconocida devuelve null', () => {
  assert.equal(describeActivityForTarget({ action: 'craft.done', target: 'p1', details: {} }), null);
});

test('describeActivityForTarget: combat.ranged_hit sin muerte', () => {
  const text = describeActivityForTarget({
    action: 'combat.ranged_hit', target: 'p1',
    details: { damage: 4, targetHpAfter: 6 },
  });
  assert.equal(text, 'Te han atacado a distancia: -4 HP (te quedan 6).');
});

test('describeActivityForTarget: combat.melee_hit con autolesión no notifica al objetivo (nadie fue atacado)', () => {
  const text = describeActivityForTarget({
    action: 'combat.melee_hit', target: 'p1',
    details: { selfInflicted: true, selfDamage: 2 },
  });
  assert.equal(text, null);
});
