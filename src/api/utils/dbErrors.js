const MYSQL_ERROR_MESSAGES = {
  ER_DUP_ENTRY: 'Ya existe un registro con ese nombre o clave única.',
  ER_NO_REFERENCED_ROW_2: 'Estás apuntando a algo que ya no existe. Refresca la página y vuelve a intentarlo.',
  ER_NO_REFERENCED_ROW: 'Estás apuntando a algo que ya no existe. Refresca la página y vuelve a intentarlo.',
  ER_ROW_IS_REFERENCED_2: 'No se puede borrar: hay otras cosas que dependen de esto.',
  ER_ROW_IS_REFERENCED: 'No se puede borrar: hay otras cosas que dependen de esto.',
  ER_CHECK_CONSTRAINT_VIOLATED: 'Un valor está fuera del rango permitido.',
  ER_DATA_TOO_LONG: 'Un texto es demasiado largo para ese campo.',
  ER_BAD_NULL_ERROR: 'Falta un campo obligatorio.',
  ER_TRUNCATED_WRONG_VALUE: 'Un número no tiene un formato válido.',
  ER_WARN_DATA_OUT_OF_RANGE: 'Un número no tiene un formato válido.',
};

export function hasKnownTranslation(err) {
  return typeof err?.code === 'string' && err.code in MYSQL_ERROR_MESSAGES;
}

export function translateMysqlError(err) {
  return MYSQL_ERROR_MESSAGES[err.code] ?? 'Error al guardar en la base de datos.';
}

export function looksLikeMysqlDriverError(err) {
  return (typeof err?.code === 'string' && err.code.startsWith('ER_')) || typeof err?.sqlState === 'string';
}
