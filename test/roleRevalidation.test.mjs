import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/services/settingsService.js', {
  namedExports: { getSetting: async (_key, fallback) => fallback, setSetting: async () => {} },
});
mock.module('../src/utils/permissions.js', {
  namedExports: { ROLE_ROLEPRIEST: ['role-rp'] },
});

const { revalidateRolepriest } = await import('../src/api/middleware/auth.js');

const reqWith = session => ({ session: { user: { id: '1', isRolepriest: true }, ...session } });

test('una comprobación reciente no vuelve a llamar a Discord', async () => {
  const req = reqWith({ roleCheckedAt: Date.now() });
  const fetchRoles = async () => { throw new Error('no debería llamarse'); };
  assert.equal(await revalidateRolepriest(req, { fetchRoles }), true);
});

test('una comprobación vencida mantiene la sesión si sigue teniendo el rol', async () => {
  const req = reqWith({ roleCheckedAt: 0 });
  assert.equal(await revalidateRolepriest(req, { fetchRoles: async () => ['role-rp'] }), true);
  assert.ok(req.session.roleCheckedAt > 0);
});

test('una comprobación vencida invalida la sesión si perdió el rol o salió del servidor', async () => {
  assert.equal(await revalidateRolepriest(reqWith({ roleCheckedAt: 0 }), { fetchRoles: async () => ['otro'] }), false);
  assert.equal(await revalidateRolepriest(reqWith({ roleCheckedAt: 0 }), { fetchRoles: async () => null }), false);
});

test('un fallo de Discord no expulsa a nadie', async () => {
  const fetchRoles = async () => { throw new Error('caído'); };
  assert.equal(await revalidateRolepriest(reqWith({ roleCheckedAt: 0 }), { fetchRoles }), true);
});

test('quien no es Rolepriest no se revalida', async () => {
  const req = { session: { user: { id: '2', isRolepriest: false } } };
  assert.equal(await revalidateRolepriest(req, { fetchRoles: async () => { throw new Error('no'); } }), true);
});
