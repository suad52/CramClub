import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageConfigError, getStorage, storageDriver, vultrConfigFromEnv } from "./index";
import { StorageKeyError } from "./keys";
import { createLocalStorage } from "./local";
import { lessonKey, sceneAudioKey } from "./types";
import { type S3Like, type VultrConfig, createVultrStorage } from "./vultr";

const JOB = "6f1c2b9e-1d1a-4c39-9a51-0d1f9b1e2a33";

describe("local driver", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ovr-storage-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("stores, describes and returns objects; missing ones are null", async () => {
    const store = createLocalStorage(dir);
    expect(store.driver).toBe("local");
    expect(await store.head(lessonKey(JOB))).toBeNull();
    expect(await store.get(lessonKey(JOB))).toBeNull();
    const put = await store.put(lessonKey(JOB), '{"title":"Hé"}', "application/json");
    expect(put).toEqual({ key: lessonKey(JOB), size: 15, contentType: "application/json" });
    expect(await store.head(lessonKey(JOB))).toEqual(put);
    expect(Buffer.from((await store.get(lessonKey(JOB)))!).toString()).toBe('{"title":"Hé"}');
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    await store.put(sceneAudioKey(JOB, 0), mp3, "audio/mpeg");
    expect(await store.get(sceneAudioKey(JOB, 0))).toEqual(mp3);
    // Rewriting a key replaces it (a retried job overwrites, never duplicates), with no temp files left.
    await store.put(sceneAudioKey(JOB, 0), new Uint8Array([1]), "audio/mpeg");
    expect((await store.head(sceneAudioKey(JOB, 0)))?.size).toBe(1);
    expect(await readdir(path.join(dir, "objects", "lessons", JOB))).toEqual([
      "lesson.json",
      "scene-0.mp3",
    ]);
    expect(await store.signedGetUrl(sceneAudioKey(JOB, 0), 60)).toBeNull();
    expect(await store.ping()).toBe(true);
  });

  it("refuses keys that could leave its folder", async () => {
    const store = createLocalStorage(dir);
    for (const key of ["../secret", "lessons/../../x", "/etc/passwd", "a//b", "lessons/.", ""])
      await expect(store.put(key, "x", "text/plain")).rejects.toBeInstanceOf(StorageKeyError);
  });
});

/** Records every S3 command; answers like Vultr would for a small in-memory bucket. */
function fakeS3() {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  const sent: unknown[] = [];
  const notFound = () =>
    Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  const client: S3Like = {
    async send(command) {
      sent.push(command);
      if (command instanceof PutObjectCommand) {
        const { Key, Body, ContentType } = command.input;
        const body = typeof Body === "string" ? Buffer.from(Body) : (Body as Uint8Array);
        objects.set(Key!, { body, type: ContentType! });
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const o = objects.get(command.input.Key!);
        if (!o) throw notFound();
        return { ContentLength: o.body.byteLength, ContentType: o.type };
      }
      if (command instanceof GetObjectCommand) {
        const o = objects.get(command.input.Key!);
        if (!o)
          throw Object.assign(new Error("NoSuchKey"), {
            name: "NoSuchKey",
            $metadata: { httpStatusCode: 404 },
          });
        return { Body: { transformToByteArray: async () => o.body } };
      }
      if (command instanceof HeadBucketCommand) return {};
      throw new Error("unexpected command");
    },
  };
  return { client, objects, sent };
}

const CONFIG: VultrConfig = {
  endpoint: "https://ewr1.vultrobjects.com",
  bucket: "ovr-lessons",
  accessKeyId: "TESTACCESSKEY",
  secretAccessKey: "test-secret-never-in-urls",
  region: "us-east-1",
};

describe("vultr driver", () => {
  it("puts private objects with their content type, and reads them back", async () => {
    const s3 = fakeS3();
    const store = createVultrStorage(CONFIG, s3.client);
    expect(store.driver).toBe("vultr");
    expect(await store.head(sceneAudioKey(JOB, 1))).toBeNull();
    expect(await store.get(sceneAudioKey(JOB, 1))).toBeNull();
    const out = await store.put(sceneAudioKey(JOB, 1), new Uint8Array([9, 9]), "audio/mpeg");
    expect(out).toEqual({ key: sceneAudioKey(JOB, 1), size: 2, contentType: "audio/mpeg" });
    const put = s3.sent.find((c) => c instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: "ovr-lessons",
      Key: `lessons/${JOB}/scene-1.mp3`,
      ContentType: "audio/mpeg",
    });
    expect(put.input.ACL).toBeUndefined();
    expect(await store.head(sceneAudioKey(JOB, 1))).toEqual(out);
    expect(await store.get(sceneAudioKey(JOB, 1))).toEqual(new Uint8Array([9, 9]));
    expect(await store.ping()).toBe(true);
    await expect(store.put("../x", "x", "text/plain")).rejects.toBeInstanceOf(StorageKeyError);
  });

  it("signs short-lived GET URLs without the secret (signing is offline)", async () => {
    const store = createVultrStorage(CONFIG, fakeS3().client);
    const url = new URL((await store.signedGetUrl(sceneAudioKey(JOB, 0), 300))!);
    expect(url.origin).toBe("https://ewr1.vultrobjects.com");
    expect(url.pathname).toBe(`/ovr-lessons/lessons/${JOB}/scene-0.mp3`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^TESTACCESSKEY\//);
    expect(url.href).not.toContain(CONFIG.secretAccessKey);
    const capped = new URL((await store.signedGetUrl(sceneAudioKey(JOB, 0), 999_999))!);
    expect(capped.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("says the bucket is unreachable instead of throwing", async () => {
    const store = createVultrStorage(CONFIG, {
      send: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await store.ping()).toBe(false);
  });
});

describe("driver choice", () => {
  const full = {
    VULTR_OBJECT_STORAGE_ENDPOINT: "ewr1.vultrobjects.com/",
    VULTR_OBJECT_STORAGE_BUCKET: "ovr-lessons",
    VULTR_OBJECT_STORAGE_ACCESS_KEY: "AKID-123",
    VULTR_OBJECT_STORAGE_SECRET_KEY: "SK",
  };

  it("uses Vultr only when all four settings are present", () => {
    expect(storageDriver({})).toBe("local");
    expect(getStorage({ LOCAL_STORAGE_DIR: tmpdir() }).driver).toBe("local");
    expect(vultrConfigFromEnv(full)).toEqual({
      endpoint: "https://ewr1.vultrobjects.com",
      bucket: "ovr-lessons",
      accessKeyId: "AKID-123",
      secretAccessKey: "SK",
      region: "us-east-1",
    });
    expect(getStorage(full).driver).toBe("vultr");
    expect(vultrConfigFromEnv({ ...full, VULTR_OBJECT_STORAGE_REGION: "ewr1" })?.region).toBe(
      "ewr1",
    );
  });

  it("refuses a partial setup, naming the missing settings but never the values", () => {
    const partial = { ...full, VULTR_OBJECT_STORAGE_SECRET_KEY: "" };
    expect(() => getStorage(partial)).toThrow(StorageConfigError);
    expect(() => getStorage(partial)).toThrow(/VULTR_OBJECT_STORAGE_SECRET_KEY/);
    expect(() => getStorage(partial)).not.toThrow(/AKID-123/);
    expect(storageDriver(partial)).toBe("invalid");
  });
});
