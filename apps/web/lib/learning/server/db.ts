import "server-only";
import postgres from "postgres";

/**
 * The Tiger Data (Postgres + TimescaleDB) connection, server-side only. One small pool per
 * server process, kept across dev hot reloads.
 */
const globalForDb = globalThis as unknown as { learningSql?: postgres.Sql };

export function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  globalForDb.learningSql ??= postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return globalForDb.learningSql;
}
