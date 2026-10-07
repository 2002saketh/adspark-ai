/**
 * Small database interface shared by the existing Node/SQLite app and the
 * future Worker/D1 adapter. This module has no Node-only imports, so it can be
 * used with env.DB in a Worker when the API runtime is migrated in a later phase.
 */
export function createD1Database(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new TypeError("A Cloudflare D1 binding is required as env.DB.");
  }
  return createAdapter(env.DB, true);
}

export function createSqliteDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("A SQLite database connection is required.");
  }
  return createAdapter(database, false);
}

function createAdapter(connection, isD1) {
  function prepare(sql, values = []) {
    if (isD1) {
      const statement = connection.prepare(sql).bind(...values);
      return {
        first: (column) => statement.first(column),
        all: () => statement.all(),
        run: () => statement.run(),
      };
    }

    const statement = connection.prepare(sql);
    return {
      first: async (column) => {
        const row = statement.get(...values) ?? null;
        return column && row ? row[column] : row;
      },
      all: async () => ({ results: statement.all(...values) }),
      run: async () => {
        const result = statement.run(...values);
        return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
      },
    };
  }

  const adapter = {
    prepare(sql) {
      let values = [];
      const bound = {
        bind(...nextValues) { values = nextValues; return bound; },
        first(column) { return prepare(sql, values).first(column); },
        all() { return prepare(sql, values).all(); },
        run() { return prepare(sql, values).run(); },
      };
      return bound;
    },
    async batch(operations) {
      if (!Array.isArray(operations) || operations.length === 0) return [];
      if (isD1) {
        return connection.batch(operations.map(({ sql, values = [] }) => connection.prepare(sql).bind(...values)));
      }
      connection.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const operation of operations) {
          const result = connection.prepare(operation.sql).run(...(operation.values || []));
          results.push({ success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } });
        }
        connection.exec("COMMIT");
        return results;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      if (!isD1) connection.close();
    },
    isD1,
  };
  return adapter;
}
