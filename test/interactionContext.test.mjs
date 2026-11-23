import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const player = { id: 5, discord_id: 'otro', character_created_at: '2026-01-01 00:00:00', is_alive: 1 };
const fakeDb = { prepare: () => ({ get: () => player, all: () => [], run: () => ({ changes: 0 }) }) };
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { rejectSelfTarget, requireOtherTarget } = await import('../src/utils/interactionContext.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const interaction = targetId => ({
  user: { id: 'rolepriest' },
  options: { getUser: () => ({ id: targetId }) },
});

test('rejectSelfTarget: un Rolepriest no puede apuntarse a sí mismo', () => {
  assert.throws(() => rejectSelfTarget(interaction('x'), 'rolepriest'), err => err instanceof UserFacingError && /auto-rolea/.test(err.message));
  assert.doesNotThrow(() => rejectSelfTarget(interaction('x'), 'otro'));
});

test('requireOtherTarget: rechaza al propio Rolepriest y devuelve a otro jugador vivo', async () => {
  await assert.rejects(() => requireOtherTarget(interaction('rolepriest')), UserFacingError);
  assert.equal((await requireOtherTarget(interaction('otro'))).id, 5);
});
