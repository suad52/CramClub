// Applies db/migrations/*.sql to DATABASE_URL (from apps/web/.env.local), in name order, once
// each. Statements run one at a time outside a transaction: TimescaleDB's continuous aggregates
// can't be created inside one. Usage: pnpm db:migrate
import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";
import { loadEnv } from "./env.mjs";

const dir = new URL("./migrations/", import.meta.url);
const sql = postgres(loadEnv().DATABASE_URL, { max: 1, onnotice: () => {} });

/** Splits a migration into statements: each ends with a semicolon at the end of a line. */
export function statements(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const list = statements(readFileSync(new URL(file, dir), "utf8"));
    for (const [i, statement] of list.entries()) {
      try {
        await sql.unsafe(statement);
      } catch (error) {
        console.error(`${file}, statement ${i + 1}:\n${statement.slice(0, 300)}\n`);
        throw error;
      }
    }
    await sql`INSERT INTO schema_migrations (name) VALUES (${file})`;
    console.log(`applied ${file} (${list.length} statements)`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
