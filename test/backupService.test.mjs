import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, existsSync, readdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const BACKUP_DIR = join(process.cwd(), 'test', '.tmp-backup-service');
const BUCKET_DIR = join(process.cwd(), 'test', '.tmp-backup-service-bucket');
process.env.BACKUP_DIR = BACKUP_DIR;
process.env.BACKUP_RETENTION = '2';
process.env.BUCKET_DIR = BUCKET_DIR;

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

function randomishText(length) {
  let out = '';
  while (out.length < length) out += Math.random().toString(36);
  return out.slice(0, length);
}

let dumpExitCode = 0;
let dumpText = randomishText(10000);
let zipExitCodes = [];
let spawned = [];

mock.module('node:child_process', {
  namedExports: {
    spawn: (command, args, options) => {
      spawned.push({ command, args, cwd: options?.cwd });
      const child = new EventEmitter();
      const isDump = command === 'mysqldump';
      const exitCode = isDump ? dumpExitCode : (zipExitCodes.shift() ?? 0);

      child.stdout = Readable.from(isDump ? [dumpText] : []);
      child.stderr = new EventEmitter();

      if (!isDump && exitCode === 0) appendFileSync(args[2], 'PK-contenido-de-mentira');

      setImmediate(() => {
        child.stderr.emit('data', Buffer.from(`${command}: aviso de prueba`));
        child.emit('close', exitCode);
      });
      return child;
    },
  },
});

const { getBackupConfig, runBackup, listBackups } = await import('../src/services/backupService.js');

test.beforeEach(() => {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  rmSync(BUCKET_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
  dumpExitCode = 0;
  zipExitCodes = [];
  dumpText = randomishText(10000);
  spawned = [];
});

test.after(() => {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  rmSync(BUCKET_DIR, { recursive: true, force: true });
});

test('getBackupConfig refleja las variables de entorno leídas al cargar el módulo', () => {
  const config = getBackupConfig();
  assert.equal(config.backupDir, BACKUP_DIR);
  assert.equal(config.retention, 2);
});

test('la copia es un único .zip, no un fichero por cada cosa', async () => {
  mkdirSync(BUCKET_DIR, { recursive: true });

  const result = await runBackup();

  assert.match(result.filename, /^roleplay-.+\.zip$/);
  assert.ok(existsSync(result.archivePath));
  assert.deepEqual(readdirSync(BACKUP_DIR), [result.filename],
    'no puede quedar ni un fichero suelto al lado, ni el directorio de staging');
});

test('el zip recibe la base de datos y el bucket como entradas del mismo archivo', async () => {
  mkdirSync(BUCKET_DIR, { recursive: true });

  const result = await runBackup();

  const zips = spawned.filter(s => s.command === 'zip');
  assert.equal(zips.length, 2, 'una invocación para el volcado y otra que añade el bucket');
  assert.ok(zips.every(z => z.args[2] === result.archivePath), 'las dos escriben en el MISMO archivo');
  assert.equal(zips[0].args[3], 'database.sql');
  assert.equal(zips[1].args[3], '.tmp-backup-service-bucket');
  assert.equal(result.bucketIncluded, true);
});

test('sin bucket montado la copia se hace igual, solo con la base de datos', async () => {
  const result = await runBackup();

  assert.equal(result.bucketIncluded, false);
  assert.equal(spawned.filter(s => s.command === 'zip').length, 1);
  assert.ok(existsSync(result.archivePath));
});

test('si el bucket falla al empaquetarse, la copia de la base de datos se conserva', async () => {
  mkdirSync(BUCKET_DIR, { recursive: true });
  zipExitCodes = [0, 14];

  const result = await runBackup();

  assert.ok(existsSync(result.archivePath), 'perder el bucket no puede llevarse por delante el volcado');
  assert.equal(result.bucketIncluded, false);
});

test('runBackup no deja el .zip a medias si mysqldump termina con código de error', async () => {
  dumpExitCode = 2;

  await assert.rejects(runBackup(), /mysqldump salió con código 2/);
  assert.deepEqual(readdirSync(BACKUP_DIR), []);
});

test('runBackup descarta un volcado sospechosamente pequeño en vez de guardarlo como copia válida', async () => {
  dumpText = 'x';

  await assert.rejects(runBackup(), /sospechosamente pequeño/);
  assert.deepEqual(readdirSync(BACKUP_DIR), []);
});

test('la rotación cuenta copias, no ficheros, y se lleva los pares del formato antiguo', async () => {
  const old = (name, minutesAgo) => {
    const path = join(BACKUP_DIR, name);
    writeFileSync(path, 'contenido');
    const when = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(path, when, when);
  };
  old('roleplay-2020-01-01T00-00-00-000Z.sql.gz', 500);
  old('roleplay-2020-01-01T00-00-00-000Z-bucket.tar.gz', 500);
  old('roleplay-2021-01-01T00-00-00-000Z.zip', 400);
  old('roleplay-2022-01-01T00-00-00-000Z.zip', 300);

  const result = await runBackup();

  const left = readdirSync(BACKUP_DIR).sort();
  assert.equal(left.length, 2, 'retención 2: la copia nueva y la más reciente de las viejas');
  assert.ok(left.includes(result.filename));
  assert.ok(left.includes('roleplay-2022-01-01T00-00-00-000Z.zip'));
  assert.ok(!left.some(f => f.startsWith('roleplay-2020-01-01')),
    'el .sql.gz y su -bucket.tar.gz emparejado cuentan como UNA copia y se van juntos');
});

test('listBackups distingue las copias unificadas de las del formato antiguo', async () => {
  writeFileSync(join(BACKUP_DIR, 'roleplay-2022-01-01T00-00-00-000Z.zip'), 'z');
  writeFileSync(join(BACKUP_DIR, 'roleplay-2020-01-01T00-00-00-000Z.sql.gz'), 'd');
  writeFileSync(join(BACKUP_DIR, 'roleplay-2020-01-01T00-00-00-000Z-bucket.tar.gz'), 'b');
  writeFileSync(join(BACKUP_DIR, 'no-es-un-backup.txt'), 'x');

  const rows = listBackups();

  assert.deepEqual(rows.map(r => r.kind).sort(), ['full', 'legacy-bucket', 'legacy-db']);
  assert.ok(rows.every(r => typeof r.sizeBytes === 'number' && r.createdAt));
  assert.ok(!rows.some(r => r.filename === 'no-es-un-backup.txt'));
});
