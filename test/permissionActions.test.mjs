import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_ACTION_NAMES, isValidPermissionAction } from '../src/utils/permissionActions.js';

const SRC_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'src');
const CATALOG_FILE = join(SRC_DIR, 'utils', 'permissionActions.js');

function collectJsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const sourceText = collectJsFiles(SRC_DIR)
  .filter(f => f !== CATALOG_FILE)
  .map(f => readFileSync(f, 'utf-8'))
  .join('\n');

test('cada acción del catálogo aparece referenciada fuera de su propia definición (enforced en algún sitio)', () => {
  const missing = PERMISSION_ACTION_NAMES.filter(action => !sourceText.includes(`'${action}'`));
  assert.deepEqual(missing, [], `Acciones declaradas en el catálogo pero nunca usadas: ${missing.join(', ')}`);
});

test('isValidPermissionAction reconoce solo acciones del catálogo cerrado', () => {
  for (const action of PERMISSION_ACTION_NAMES) {
    assert.equal(isValidPermissionAction(action), true);
  }
  assert.equal(isValidPermissionAction('algo.inventado'), false);
});
