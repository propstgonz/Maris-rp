const MAX_EXECUTION_MS = 5000;

const FORBIDDEN = [
  [/\binto\s+(outfile|dumpfile)\b/i, 'INTO OUTFILE/DUMPFILE no está permitido.'],
  [/\bload_file\s*\(/i, 'LOAD_FILE no está permitido.'],
  [/\bsleep\s*\(/i, 'SLEEP no está permitido.'],
  [/\bbenchmark\s*\(/i, 'BENCHMARK no está permitido.'],
  [/\bget_lock\s*\(/i, 'GET_LOCK no está permitido.'],
  [/\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i, 'Las lecturas con bloqueo no están permitidas.'],
  [/\bmysql\s*\./i, 'El schema mysql no es accesible desde el terminal.'],
  [/\bweb_sessions\b/i, 'La tabla de sesiones no es accesible desde el terminal.'],
];

function stripStringLiterals(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g, "''").replace(/`/g, '');
}

export function validateReadOnlySql(text) {
  const sql = String(text ?? '').trim();
  if (!sql) return 'Escribe una consulta SQL.';
  if (!/^select\s/i.test(sql)) return 'Solo se permiten consultas SELECT — este terminal es de solo lectura.';
  const bare = stripStringLiterals(sql);
  if (/\/\*|--|#|;/.test(bare)) return 'No se permiten comentarios ni varias sentencias.';
  for (const [pattern, message] of FORBIDDEN) {
    if (pattern.test(bare)) return message;
  }
  return null;
}

export function withExecutionLimit(sql) {
  return sql.replace(/^select\s/i, `SELECT /*+ MAX_EXECUTION_TIME(${MAX_EXECUTION_MS}) */ `);
}
