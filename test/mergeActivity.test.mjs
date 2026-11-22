import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePlayerActivity } from '../src/mapServer/utils/mergeActivity.js';

const PLAYER = 'player-1';

test('combina audit_log y transactions en una única lista ordenada por fecha DESC', () => {
  const audit = [{ created_at: '2026-08-20 10:00:00', source: 'discord', action: 'craft.done', target: 'espada', details: null }];
  const trades = [{
    created_at: '2026-08-21 10:00:00', from_discord_id: PLAYER, to_discord_id: 'other',
    from_username: 'Yo', to_username: 'Otro', item: { name: 'madera', display_name: 'Madera', emoji: '🪵' },
    quantity: 5, coord_x: 1, coord_y: 2,
  }];
  const result = mergePlayerActivity(audit, trades, PLAYER);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'trade');
  assert.equal(result[1].kind, 'audit');
});

test('marca "sent" cuando el jugador de la ficha es el emisor del trade', () => {
  const trades = [{
    created_at: '2026-08-21 10:00:00', from_discord_id: PLAYER, to_discord_id: 'other',
    from_username: 'Yo', to_username: 'Otro', item: { name: 'madera', display_name: 'Madera', emoji: '🪵' },
    quantity: 5, coord_x: 1, coord_y: 2,
  }];
  const [entry] = mergePlayerActivity([], trades, PLAYER);
  assert.equal(entry.direction, 'sent');
  assert.deepEqual(entry.counterpart, { discordId: 'other', username: 'Otro' });
});

test('marca "received" cuando el jugador de la ficha es el receptor del trade', () => {
  const trades = [{
    created_at: '2026-08-21 10:00:00', from_discord_id: 'other', to_discord_id: PLAYER,
    from_username: 'Otro', to_username: 'Yo', item: { name: 'madera', display_name: 'Madera', emoji: '🪵' },
    quantity: 5, coord_x: 1, coord_y: 2,
  }];
  const [entry] = mergePlayerActivity([], trades, PLAYER);
  assert.equal(entry.direction, 'received');
  assert.deepEqual(entry.counterpart, { discordId: 'other', username: 'Otro' });
});

test('respeta el límite tras combinar y ordenar (no antes)', () => {
  const audit = [
    { created_at: '2026-08-20 09:00:00', source: 'discord', action: 'craft.done', target: 'a', details: null },
    { created_at: '2026-08-22 09:00:00', source: 'discord', action: 'craft.done', target: 'b', details: null },
  ];
  const trades = [{
    created_at: '2026-08-21 09:00:00', from_discord_id: PLAYER, to_discord_id: 'other',
    from_username: 'Yo', to_username: 'Otro', item: { name: 'x', display_name: 'X', emoji: '📦' },
    quantity: 1, coord_x: 0, coord_y: 0,
  }];
  const result = mergePlayerActivity(audit, trades, PLAYER, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].target, 'b');
  assert.equal(result[1].kind, 'trade');
});

test('sin filas de ninguna fuente, devuelve una lista vacía sin lanzar', () => {
  assert.deepEqual(mergePlayerActivity([], [], PLAYER), []);
});

test('detalles del audit se pasan tal cual (ya vienen parseados de auditLogService)', () => {
  const audit = [{ created_at: '2026-08-20 10:00:00', source: 'web', action: 'player.kill', target: PLAYER, details: { reason: 'prueba' } }];
  const [entry] = mergePlayerActivity(audit, [], PLAYER);
  assert.equal(entry.kind, 'audit');
  assert.deepEqual(entry.details, { reason: 'prueba' });
});
