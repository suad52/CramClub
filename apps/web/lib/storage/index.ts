import "server-only";
import { createHash } from "node:crypto";
import { type Env, createLocalStorage, defaultLocalRoot } from "./local";
import type { ObjectStorage } from "./types";
import { type VultrConfig, createVultrStorage } from "./vultr";

export * from "./types";

/**
 * The object storage for generated learning materials, picked from the environment at call time
 * (the web app and the worker share this): Vultr Object Storage when all four
 * VULTR_OBJECT_STORAGE_* settings are present, local disk otherwise. A partial Vultr setup is an
 * error rather than a silent fallback, so production never writes students' files to a server's
 * disk by mistake. Errors name the missing settings, never their values.
 */

const VULTR_ENV = {
  endpoint: "VULTR_OBJECT_STORAGE_ENDPOINT",
  bucket: "VULTR_OBJECT_STORAGE_BUCKET",
  accessKeyId: "VULTR_OBJECT_STORAGE_ACCESS_KEY",
  secretAccessKey: "VULTR_OBJECT_STORAGE_SECRET_KEY",
} as const;

export class StorageConfigError extends Error {
  constructor(missing: string[]) {
    super(`Vultr Object Storage is partly configured: set ${missing.join(", ")}`);
    this.name = "StorageConfigError";
  }
}

/** The Vultr settings, null when none are set; throws if only some are. */
export function vultrConfigFromEnv(env: Env = process.env): VultrConfig | null {
  const values = Object.fromEntries(
    Object.entries(VULTR_ENV).map(([field, name]) => [field, env[name]?.trim() ?? ""]),
  ) as Record<keyof typeof VULTR_ENV, string>;
  const missing = Object.entries(VULTR_ENV)
    .filter(([field]) => !values[field as keyof typeof VULTR_ENV])
    .map(([, name]) => name);
  if (missing.length === Object.keys(VULTR_ENV).length) return null;
  if (missing.length) throw new StorageConfigError(missing);
  const endpoint = /^https?:\/\//i.test(values.endpoint)
    ? values.endpoint.replace(/\/+$/, "")
    : `https://${values.endpoint.replace(/\/+$/, "")}`;
  return {
    ...values,
    endpoint,
    region: env.VULTR_OBJECT_STORAGE_REGION?.trim() || "us-east-1",
  };
}

let cached: { signature: string; storage: ObjectStorage } | null = null;

export function getStorage(env: Env = process.env): ObjectStorage {
  const vultr = vultrConfigFromEnv(env);
  const signature = vultr
    ? `vultr|${vultr.endpoint}|${vultr.region}|${vultr.bucket}|${vultr.accessKeyId}|${createHash("sha256").update(vultr.secretAccessKey).digest("hex")}`
    : `local|${defaultLocalRoot(env)}`;
  if (cached?.signature !== signature)
    cached = {
      signature,
      storage: vultr ? createVultrStorage(vultr) : createLocalStorage(defaultLocalRoot(env)),
    };
  return cached.storage;
}

/** Which driver getStorage() would use, without throwing (for status pages and logs). */
export function storageDriver(env: Env = process.env): "vultr" | "local" | "invalid" {
  try {
    return vultrConfigFromEnv(env) ? "vultr" : "local";
  } catch {
    return "invalid";
  }
}
