"use client";

import { ApiError } from "@/components/progress/api";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import type {
  CollectionSummary,
  ItemDetail,
  LessonProgress,
  LibraryItem,
  SaveResult,
} from "./types";

/**
 * The browser's calls to the personal library (/api/me/*). Same-origin with the session cookie:
 * nothing here sends an owner or user id, and the server decides what's yours.
 */

async function call<T>(url: string, method: string, payload?: unknown, keepalive = false) {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach the library's server.");
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: unknown; message?: unknown };
  } | null;
  if (!res.ok) {
    const error = body?.error;
    throw new ApiError(
      res.status,
      typeof error?.code === "string" ? error.code : "http_error",
      typeof error?.message === "string"
        ? error.message
        : `The server couldn't answer (${res.status}).`,
    );
  }
  if (body === null || typeof body !== "object")
    throw new ApiError(res.status, "bad_response", "The server sent something unexpected.");
  return body as T;
}

const enc = encodeURIComponent;

export const listCollections = () =>
  call<{ collections: CollectionSummary[] }>("/api/me/collections", "GET");

export const createCollection = (name: string) =>
  call<CollectionSummary>("/api/me/collections", "POST", { name });

export const renameCollection = (id: string, name: string) =>
  call<CollectionSummary>(`/api/me/collections/${enc(id)}`, "PATCH", { name });

export const deleteCollection = (id: string) =>
  call<{ ok: true }>(`/api/me/collections/${enc(id)}`, "DELETE");

export type NewItemInput =
  | { kind: "resource"; sourceId: string }
  | { kind: "resource"; title: string; url: string; summary?: string }
  | { kind: "plan"; planId: string }
  | { kind: "note"; title: string; text: string };

export const addItem = (collectionId: string, item: NewItemInput) =>
  call<SaveResult>(`/api/me/collections/${enc(collectionId)}/items`, "POST", item);

export const getItem = (collectionId: string, itemId: string) =>
  call<ItemDetail>(`/api/me/collections/${enc(collectionId)}/items/${enc(itemId)}`, "GET");

export const removeItem = (collectionId: string, itemId: string) =>
  call<{ ok: true }>(`/api/me/collections/${enc(collectionId)}/items/${enc(itemId)}`, "DELETE");

export const updateItem = (
  collectionId: string,
  itemId: string,
  patch: { title?: string; summary?: string; text?: string; progress?: LessonProgress },
  keepalive = false,
) =>
  call<{ item: LibraryItem }>(
    `/api/me/collections/${enc(collectionId)}/items/${enc(itemId)}`,
    "PATCH",
    patch,
    keepalive,
  );

export const unsaveSource = (sourceId: string) =>
  call<{ ok: true }>(`/api/me/saved/${enc(sourceId)}`, "DELETE");

export const savePlan = (planId: string) => call<SaveResult>("/api/me/plans", "POST", { planId });

/** The most notes text a lesson save sends (the server keeps what fits, from the start). */
const MAX_SEND_BYTES = 450_000;

export function saveLesson(input: {
  lesson: Lesson;
  chunks: Chunk[];
  sourceName?: string;
  progress?: LessonProgress;
}) {
  const size = (chunks: Chunk[]) => new Blob([JSON.stringify({ ...input, chunks })]).size;
  let chunks = input.chunks;
  if (size(chunks) > MAX_SEND_BYTES) {
    let lo = 0;
    let hi = chunks.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (size(chunks.slice(0, mid)) <= MAX_SEND_BYTES) lo = mid;
      else hi = mid - 1;
    }
    chunks = chunks.slice(0, lo);
  }
  return call<SaveResult>("/api/me/lessons", "POST", { ...input, chunks });
}
