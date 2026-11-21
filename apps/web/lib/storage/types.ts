/**
 * Object storage for generated learning materials (narration MP3s, lesson documents).
 *
 * Driver "vultr": Vultr Object Storage through its S3-compatible API (@aws-sdk/client-s3), chosen
 * when VULTR_OBJECT_STORAGE_ENDPOINT, _BUCKET, _ACCESS_KEY and _SECRET_KEY are set (server-only
 * env; never NEXT_PUBLIC_). The bucket is PRIVATE: files are read only through the API after an
 * access check, via short-lived presigned GET URLs.
 * Driver "local": files under apps/web/.data/storage for development (gitignored); read by
 * streaming through the API.
 *
 * Keys are deterministic, so a retried job overwrites rather than duplicates:
 *   lessons/<jobId>/lesson.json
 *   lessons/<jobId>/scene-<n>.mp3
 */

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface ObjectStorage {
  readonly driver: "vultr" | "local";
  put(key: string, body: Uint8Array | string, contentType: string): Promise<StoredObject>;
  /** null when missing. */
  head(key: string): Promise<StoredObject | null>;
  /** Raw bytes (used by the worker and the local driver's streaming route). */
  get(key: string): Promise<Uint8Array | null>;
  /** A short-lived URL a browser may GET (vultr), or null when the API must stream it (local). */
  signedGetUrl(key: string, ttlSeconds: number): Promise<string | null>;
  /** For /api/health: can we reach the bucket? */
  ping(): Promise<boolean>;
}

export const lessonKey = (jobId: string) => `lessons/${jobId}/lesson.json`;
export const sceneAudioKey = (jobId: string, scene: number) =>
  `lessons/${jobId}/scene-${scene}.mp3`;
