export function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 50) || 'jugador'
  );
}

export const GENDER_CHOICES = [
  { name: 'Hombre', value: 'hombre' },
  { name: 'Mujer',  value: 'mujer' },
];

export function genderLabel(gender) {
  const choice = GENDER_CHOICES.find(c => c.value === gender);
  return choice ? choice.name : '*Sin especificar*';
}
