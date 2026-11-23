const FORMS = {
  hombre: { single: 'Soltero', married: 'Casado', widowed: 'Viudo' },
  mujer: { single: 'Soltera', married: 'Casada', widowed: 'Viuda' },
};

const NEUTRAL = { single: 'Soltero/a', married: 'Casado/a', widowed: 'Viudo/a' };

export function civilStatusLabel({ active, lastEndReason, endedByPlayerId = null, playerId = null, gender }) {
  const forms = FORMS[gender] ?? NEUTRAL;
  if (active) return forms.married;
  const survivor = endedByPlayerId === null || endedByPlayerId !== playerId;
  if (lastEndReason === 'viudedad' && survivor) return forms.widowed;
  return forms.single;
}
