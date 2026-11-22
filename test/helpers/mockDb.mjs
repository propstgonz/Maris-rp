export function makeFakeNamedExports(fakeDb) {
  return {
    query: async (sql, params = []) => fakeDb.prepare(sql).all(...params),
    queryOne: async (sql, params = []) => fakeDb.prepare(sql).get(...params),
    execute: async (sql, params = []) => fakeDb.prepare(sql).run(...params),

    withTransaction: async (fn) => fn(),
  };
}

const fakeStatement = {
  get: () => undefined,
  all: () => [],
  run: () => ({ changes: 0, lastInsertRowid: 0 }),
};

export function makeFakeDb() {
  return {
    prepare: () => fakeStatement,
    exec: () => {},
    pragma: () => {},

    transaction: (fn) => (...args) => fn(...args),
    close: () => {},
  };
}
