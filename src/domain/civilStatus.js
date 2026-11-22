const FORMS = {
  hombre: { single: 'Soltero', married: 'Casado', widowed: 'Viudo' },
  mujer: { single: 'Soltera', married: 'Casada', widowed: 'Viuda' },
};

const NEUTRAL = { single: 'Soltero/a', married: 'Casado/a', widowed: 'Viudo/a' };

export function civilStatusLabel({ active, lastEndReason, gender }) {
  const forms = FORMS[gender] ?? NEUTRAL;
  if (active) return forms.married;
  if (lastEndReason === 'viudedad') return forms.widowed;
  return forms.single;
}
