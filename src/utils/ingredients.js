export function parseIngredients(raw) {
  if (!raw?.trim()) return [];

  return raw.split(',').map((part, idx) => {
    const trimmed = part.trim();
    const colonAt = trimmed.indexOf(':');

    if (colonAt === -1) {
      throw new Error(
        `Formato inválido en el ingrediente ${idx + 1}: \`${trimmed}\`.\n` +
        `Usa \`nombre:cantidad\` separado por comas. Ej: \`hierro:3,madera:2\``
      );
    }

    const name     = trimmed.slice(0, colonAt).trim().toLowerCase();
    const rawQty   = trimmed.slice(colonAt + 1).trim();
    const quantity = parseFloat(rawQty);

    if (!name) throw new Error(`El nombre del ingrediente ${idx + 1} está vacío.`);
    if (isNaN(quantity) || quantity <= 0) {
      throw new Error(`Cantidad inválida para el ingrediente \`${name}\`: \`${rawQty}\` no es un número positivo.`);
    }
    if (name === 'laburo') {
      throw new Error('El Laburo no puede ser un ingrediente normal — usa el campo `laburo_coste` para exigirlo.');
    }

    return { name, quantity };
  });
}
