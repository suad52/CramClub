// Reads apps/web/.env.local for the db scripts (Next loads it for the app itself). Never prints it.
import { existsSync, readFileSync } from "node:fs";

export function loadEnv() {
  const file = new URL("../.env.local", import.meta.url);
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (apps/web/.env.local). See docs/learning-analytics.md.");
    process.exit(1);
  }
  return env;
}
