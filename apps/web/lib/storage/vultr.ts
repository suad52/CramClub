import "server-only";
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertKey, byteLength } from "./keys";
import type { ObjectStorage, StoredObject } from "./types";

/**
 * Vultr Object Storage through its S3-compatible API. The bucket stays private: objects are
 * written without any ACL (so they inherit the bucket's private default) and read back only by
 * the server, or by a browser through a short-lived presigned GET URL after the API's access
 * check. Credentials come from server-only env and are never logged or put in a URL (a presigned
 * URL carries the access key id and a signature, never the secret).
 */

export interface VultrConfig {
  /** e.g. https://ewr1.vultrobjects.com (the bucket's region hostname). */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Vultr accepts any region name for signing; "us-east-1" unless set. */
  region: string;
}

/** The S3 calls this driver makes, so tests can pass a fake. */
export interface S3Like {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export const PRESIGN_MAX_SECONDS = 3600;

export function vultrClient(config: VultrConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Path-style (https://ewr1.vultrobjects.com/<bucket>/<key>) works for every bucket name.
    forcePathStyle: true,
    // Only send/check checksums when an operation requires them: S3-compatible services don't
    // all accept the newer default checksum headers on PutObject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
}

const status = (err: unknown) =>
  (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const missing = (err: unknown) => {
  const name = (err as { name?: string }).name;
  return name === "NotFound" || name === "NoSuchKey" || status(err) === 404;
};

export function createVultrStorage(config: VultrConfig, client?: S3Like): ObjectStorage {
  const s3 = vultrClient(config);
  const api: S3Like = client ?? s3;
  const Bucket = config.bucket;
  return {
    driver: "vultr",

    async put(key, body, contentType): Promise<StoredObject> {
      assertKey(key);
      await api.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: byteLength(body),
          // Keys are rewritten in place on a retry, so browsers shouldn't cache them for long.
          CacheControl: "private, max-age=300",
        }),
      );
      return { key, size: byteLength(body), contentType };
    },

    async head(key) {
      assertKey(key);
      try {
        const out = (await api.send(new HeadObjectCommand({ Bucket, Key: key }))) as {
          ContentLength?: number;
          ContentType?: string;
        };
        return {
          key,
          size: out.ContentLength ?? 0,
          contentType: out.ContentType ?? "application/octet-stream",
        };
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },

    async get(key) {
      assertKey(key);
      try {
        const out = (await api.send(new GetObjectCommand({ Bucket, Key: key }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        return out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },

    async signedGetUrl(key, ttlSeconds) {
      assertKey(key);
      const expiresIn = Math.max(1, Math.min(PRESIGN_MAX_SECONDS, Math.round(ttlSeconds)));
      // Signing is local (no request is made), so it always uses the real client's config.
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
    },

    async ping() {
      try {
        await api.send(new HeadBucketCommand({ Bucket }), {
          abortSignal: AbortSignal.timeout(5_000),
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
