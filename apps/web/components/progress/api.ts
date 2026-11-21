"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Talking to /api/learning/* from the dashboard. Every call is same-origin: the learner is the
 * httpOnly cookie, never an id we send.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's error code ("not_configured", …), or "network" / "bad_response". */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function asApiError(err: unknown) {
  return err instanceof ApiError ? err : new ApiError(0, "unknown", "Something went wrong.");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", "Couldn't reach the library's server.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    body = null;
  }
  if (!res.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
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

export const getJson = <T>(url: string, signal?: AbortSignal) => request<T>(url, { signal });

export const postJson = <T>(url: string, payload: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser thinks it's online (true while server rendering). */
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export interface Resource<T> {
  /** The latest answer for this URL (kept while a reload is on its way). */
  data: T | undefined;
  /** The latest attempt failed. */
  error: ApiError | undefined;
  /** An answer for this URL is on its way. */
  loading: boolean;
  reload: () => void;
}

interface Answer<T> {
  url: string;
  attempt: number;
  data?: T;
  error?: ApiError;
}

/**
 * GETs `url` (nothing while it's null), again whenever it changes, on `reload()`, and when the
 * browser comes back online. Offline, it waits rather than failing.
 */
export function useApi<T>(url: string | null): Resource<T> {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer<T> | null>(null);

  useEffect(() => {
    if (!url || !online) return;
    const ctrl = new AbortController();
    getJson<T>(url, ctrl.signal).then(
      (data) => setAnswer({ url, attempt, data }),
      (err: unknown) => {
        if (!ctrl.signal.aborted) setAnswer({ url, attempt, error: asApiError(err) });
      },
    );
    return () => ctrl.abort();
  }, [url, attempt, online]);

  const current = url && answer?.url === url ? answer : null;
  const settled = current?.attempt === attempt;
  return {
    data: current?.data,
    error: settled ? current?.error : undefined,
    loading: !!url && !settled,
    reload: () => setAttempt((n) => n + 1),
  };
}
