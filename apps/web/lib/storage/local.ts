import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertKey, byteLength } from "./keys";
import type { ObjectStorage, StoredObject } from "./types";

/**
 * Development storage: files on local disk (apps/web/.data/storage by default, gitignored), read
 * back by streaming them through the API after its access check (signedGetUrl is null). Writes go
 * to a temporary file that is then renamed, so a crash never leaves a half-written object that
 * head() would report as done.
 */

/** apps/web/.data/storage when the web app or the worker runs from apps/web (pnpm scripts do). */
export const defaultLocalRoot = (env: Env = process.env) =>
  env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), ".data/storage");

/** Environment variables (process.env, or a plain object in tests). */
export type Env = Record<string, string | undefined>;

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const notFound = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

export function createLocalStorage(root: string = defaultLocalRoot()): ObjectStorage {
  const file = (key: string) => path.join(root, "objects", ...assertKey(key).split("/"));
  const meta = (key: string) => `${path.join(root, "meta", ...assertKey(key).split("/"))}.json`;

  async function atomicWrite(target: string, data: Uint8Array | string) {
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, target);
  }

  return {
    driver: "local",

    async put(key, body, contentType): Promise<StoredObject> {
      await atomicWrite(file(key), body);
      await atomicWrite(meta(key), JSON.stringify({ contentType }));
      return { key, size: byteLength(body), contentType };
    },

    async head(key) {
      try {
        const info = await stat(file(key));
        let contentType = TYPES[path.extname(key)] ?? "application/octet-stream";
        try {
          const saved = JSON.parse(await readFile(meta(key), "utf8")) as { contentType?: unknown };
          if (typeof saved.contentType === "string") contentType = saved.contentType;
        } catch {
          // No sidecar (written by hand, or a crash between the two writes): guess from the name.
        }
        return { key, size: info.size, contentType };
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(file(key)));
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },

    async signedGetUrl() {
      return null;
    },

    async ping() {
      try {
        await mkdir(path.join(root, "objects"), { recursive: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}
