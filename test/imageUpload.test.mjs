import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveImageBuffer,
  validateImageBuffer,
  sanitizeFilenameComponent,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '../src/utils/imageUpload.js';

const REAL_PNG  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
const REAL_JPG  = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
const REAL_GIF  = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const REAL_WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x57, 0x45, 0x42, 0x50]),
]);
const NOT_AN_IMAGE = Buffer.from('<script>alert(1)</script>', 'utf-8');

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'imgtest-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('ALLOWED_IMAGE_TYPES cubre exactamente PNG/JPEG/WEBP/GIF', () => {
  assert.deepEqual(Object.keys(ALLOWED_IMAGE_TYPES).sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
});

test('validateImageBuffer rechaza un tipo MIME no permitido', () => {
  const result = validateImageBuffer({ mimetype: 'application/pdf', size: 100 });
  assert.equal(result.ok, false);
});

test('validateImageBuffer rechaza un fichero por encima del límite de tamaño', () => {
  const result = validateImageBuffer({ mimetype: 'image/png', size: MAX_IMAGE_SIZE_BYTES + 1 });
  assert.equal(result.ok, false);
});

test('validateImageBuffer acepta un PNG dentro de límite', () => {
  const result = validateImageBuffer({ mimetype: 'image/png', size: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.ext, 'png');
});

test('saveImageBuffer guarda un PNG real cuando los bytes coinciden con la extensión', async () => {
  await withTempDir(async (dir) => {
    const result = await saveImageBuffer(REAL_PNG, 'png', dir, 'item_prueba');
    assert.equal(result.filename, 'item_prueba.png');
    const files = await readdir(dir);
    assert.deepEqual(files, ['item_prueba.png']);
  });
});

test('saveImageBuffer guarda un JPG, GIF y WEBP reales sin problema', async () => {
  await withTempDir(async (dir) => {
    await saveImageBuffer(REAL_JPG, 'jpg', dir, 'a');
    await saveImageBuffer(REAL_GIF, 'gif', dir, 'b');
    await saveImageBuffer(REAL_WEBP, 'webp', dir, 'c');
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['a.jpg', 'b.gif', 'c.webp']);
  });
});

test('saveImageBuffer RECHAZA un fichero que no es una imagen aunque declare serlo', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => saveImageBuffer(NOT_AN_IMAGE, 'png', dir, 'malicioso'),
      /no coincide con el formato declarado/
    );
    const files = await readdir(dir).catch(() => []);
    assert.equal(files.length, 0, 'nada debería haberse escrito al disco');
  });
});

test('saveImageBuffer RECHAZA un PNG real subido con la extensión de otro formato', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => saveImageBuffer(REAL_PNG, 'gif', dir, 'x'));
  });
});

test('sanitizeFilenameComponent conserva un nombre de catálogo normal tal cual', () => {
  assert.equal(sanitizeFilenameComponent('pico_hierro'), 'pico_hierro');
  assert.equal(sanitizeFilenameComponent('mina-de-oro'), 'mina-de-oro');
});

test('sanitizeFilenameComponent quita cualquier carácter fuera de [a-z0-9_-]', () => {
  assert.equal(sanitizeFilenameComponent('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeFilenameComponent('nombre con espacios'), 'nombreconespacios');
  assert.equal(sanitizeFilenameComponent('Item.PNG'), 'itempng');
});

test('sanitizeFilenameComponent lanza si tras sanear no queda nada válido', () => {
  assert.throws(() => sanitizeFilenameComponent('../../../'));
  assert.throws(() => sanitizeFilenameComponent('***'));
  assert.throws(() => sanitizeFilenameComponent(''));
});

test('saveImageBuffer limpia la variante anterior en otro formato (evita huérfanos)', async () => {
  await withTempDir(async (dir) => {
    await saveImageBuffer(REAL_PNG, 'png', dir, 'avatar_1');
    let files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['avatar_1.png']);

    await saveImageBuffer(REAL_JPG, 'jpg', dir, 'avatar_1');
    files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['avatar_1.jpg']);
  });
});
