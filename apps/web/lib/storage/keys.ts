/**
 * Object keys are made by the server (lib/storage/types.ts lessonKey / sceneAudioKey), but every
 * driver still checks them: relative path segments, absolute paths and odd characters are refused,
 * so a key can never escape the local storage folder or address something unexpected in a bucket.
 */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class StorageKeyError extends Error {
  constructor() {
    super("Invalid storage key");
    this.name = "StorageKeyError";
  }
}

export function assertKey(key: string): string {
  if (key.length > 512 || !KEY.test(key) || key.split("/").some((part) => /^\.+$/.test(part)))
    throw new StorageKeyError();
  return key;
}

export const byteLength = (body: Uint8Array | string) =>
  typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
