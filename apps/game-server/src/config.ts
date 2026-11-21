import { logger } from "@colyseus/core";

/**
 * Settings read from the environment (apps/game-server/.env locally):
 *
 * - GAME_TICKET_SECRET: the HMAC secret the web app signs join tickets with. Without it nobody
 *   can join (every ticket is refused).
 * - ALLOWED_ORIGINS: comma-separated web origins allowed to connect from a browser, e.g.
 *   "http://localhost:3100,https://ovr.example". Unset: any origin (with a warning at startup).
 * - WEB_INTERNAL_URL: where this server reaches the web app, server to server, to ask for
 *   Ms. Fenwick's chat replies (POST <url>/api/internal/fenwick-chat, signed with
 *   GAME_TICKET_SECRET: packages/shared net/internal.ts). Default http://localhost:3100 (the dev
 *   web app); in Docker Compose http://web:3100. Not a URL: she stays quiet in the chat (with a
 *   warning at startup), as she does without GAME_TICKET_SECRET.
 *
 * The Origin check only stops other websites from using a visitor's browser to connect: a
 * non-browser client sends whatever Origin it likes, so the ticket stays the real gate.
 */
export interface GameServerConfig {
  ticketSecret: string | undefined;
  /** Normalised origins ("http://localhost:3100"), or null to allow any. */
  allowedOrigins: ReadonlySet<string> | null;
  /** The web app's base URL for internal requests, no trailing slash; null: Fenwick chat off. */
  webInternalUrl: string | null;
}

/** WEB_INTERNAL_URL when it isn't set. */
export const DEFAULT_WEB_INTERNAL_URL = "http://localhost:3100";

/**
 * "http://web:3100/" → "http://web:3100" (a path prefix is kept, without its trailing slash);
 * unset → the default; null for anything that isn't an http(s) URL.
 */
export function parseWebInternalUrl(value: string | undefined): string | null {
  const raw = value?.trim() || DEFAULT_WEB_INTERNAL_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
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
    webInternalUrl: parseWebInternalUrl(env.WEB_INTERNAL_URL),
  };
}

/** The settings in force (createGameServer sets them; the environment otherwise). */
export function serverConfig(): GameServerConfig {
  return (current ??= configFromEnv());
}

export function setServerConfig(config: GameServerConfig): void {
  current = config;
}
