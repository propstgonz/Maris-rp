import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReadOnlySql, withExecutionLimit } from '../src/api/utils/sqlGuard.js';

test('una SELECT normal pasa', () => {
  assert.equal(validateReadOnlySql('SELECT id, name FROM rp_players.players WHERE name = \'a;b\''), null);
  assert.equal(validateReadOnlySql('select 1'), null);
});

test('rechaza lo que no es SELECT', () => {
  assert.ok(validateReadOnlySql('DELETE FROM rp_players.players'));
  assert.ok(validateReadOnlySql('  '));
});

test('rechaza lectura de ficheros, esperas y bloqueos', () => {
  for (const sql of [
    "SELECT LOAD_FILE('/etc/passwd')",
    'SELECT SLEEP(10)',
    'SELECT BENCHMARK(1000000, MD5(1))',
    "SELECT 1 INTO OUTFILE '/tmp/x'",
    "SELECT 1 INTO DUMPFILE '/tmp/x'",
    'SELECT * FROM rp_players.players FOR UPDATE',
    "SELECT GET_LOCK('a', 10)",
  ]) {
    assert.ok(validateReadOnlySql(sql), sql);
  }
});

test('rechaza el schema mysql y la tabla de sesiones, también con backticks', () => {
  assert.ok(validateReadOnlySql('SELECT * FROM mysql.user'));
  assert.ok(validateReadOnlySql('SELECT * FROM `mysql`.`user`'));
  assert.ok(validateReadOnlySql('SELECT * FROM rp_ops.web_sessions'));
});

test('rechaza comentarios y varias sentencias', () => {
  assert.ok(validateReadOnlySql('SELECT 1 /*! ,SLEEP(5) */'));
  assert.ok(validateReadOnlySql('SELECT 1; DROP TABLE x'));
  assert.ok(validateReadOnlySql('SELECT 1 -- x'));
});

test('withExecutionLimit añade la pista de tiempo máximo', () => {
  assert.match(withExecutionLimit('SELECT 1'), /^SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ 1$/);
});

test('rechaza FOR SHARE y los schemas de sistema', () => {
  assert.ok(validateReadOnlySql('SELECT * FROM rp_players.players FOR SHARE'));
  assert.ok(validateReadOnlySql('SELECT * FROM performance_schema.threads'));
  assert.ok(validateReadOnlySql('SELECT * FROM sys.session'));
  assert.ok(validateReadOnlySql('SELECT * FROM information_schema.tables'));
  assert.equal(validateReadOnlySql('SELECT id FROM rp_players.players'), null);
});
