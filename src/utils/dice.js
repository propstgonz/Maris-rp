export function rollDie(sides = 6) {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error('El número de caras debe ser un entero ≥ 2.');
  }
  return Math.floor(Math.random() * sides) + 1;
}
