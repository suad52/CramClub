import { logger } from "@colyseus/core";

/**
 * Settings read from the environment (apps/game-server/.env locally):
 *
 * - GAME_TICKET_SECRET: the HMAC secret the web app signs join tickets with. Without it nobody
 *   can join (every ticket is refused).
 * - ALLOWED_ORIGINS: comma-separated web origins allowed to connect from a browser, e.g.
 *   "http://localhost:3100,https://ovr.example". Unset: any origin (with a warning at startup).
 *
 * The Origin check only stops other websites from using a visitor's browser to connect: a
 * non-browser client sends whatever Origin it likes, so the ticket stays the real gate.
 */
export interface GameServerConfig {
  ticketSecret: string | undefined;
  /** Normalised origins ("http://localhost:3100"), or null to allow any. */
  allowedOrigins: ReadonlySet<string> | null;
}

/** "http://localhost:3100/" → "http://localhost:3100"; null for anything that isn't a URL. */
function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> | null {
  const list = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return null;
  const origins = new Set<string>();
  for (const entry of list) {
    const origin = normaliseOrigin(entry);
    if (origin) origins.add(origin);
    else logger.warn(`[config] ignoring ALLOWED_ORIGINS entry that isn't an origin: ${entry}`);
  }
  return origins;
}

/**
 * Whether a connection with this Origin header may proceed. No header: not a browser (a test,
 * a server), allowed through to the ticket check. A header must match the allow-list exactly.
 */
export function originAllowed(
  origin: string | null | undefined,
  allowed: ReadonlySet<string> | null,
): boolean {
  if (!origin) return true;
  if (!allowed) return true;
  const normal = normaliseOrigin(origin);
  return normal !== null && allowed.has(normal);
}

let current: GameServerConfig | null = null;

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GameServerConfig {
  return {
    ticketSecret: env.GAME_TICKET_SECRET?.trim() || undefined,
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
  };
}

/** The settings in force (createGameServer sets them; the environment otherwise). */
export function serverConfig(): GameServerConfig {
  return (current ??= configFromEnv());
}

export function setServerConfig(config: GameServerConfig): void {
  current = config;
}
