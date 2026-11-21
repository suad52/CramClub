"use client";

import { useEffect, useState } from "react";
import { ApiError, asApiError, getJson } from "@/components/progress/api";
import type { CircleDetail } from "@/lib/circles/types";

/**
 * Talking to /api/circles/* (contract in lib/circles/types.ts). Same-origin requests: who's asking
 * is the Auth0 session cookie, never an id we send. Errors are ApiErrors with the server's code
 * and message, so permission messages reach the screen as the server wrote them.
 */
export { ApiError, asApiError, getJson };

export async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach the library's server. Check your connection.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    throw new ApiError(
      res.status,
      typeof error?.code === "string" ? error.code : "http_error",
      typeof error?.message === "string"
        ? error.message
        : `The server couldn't do that (${res.status}).`,
    );
  }
  return body as T;
}

/** The error codes that mean "sign in" or "sign-in isn't set up", not a problem with the circle. */
export const isAuthError = (error: ApiError | undefined) =>
  error?.code === "sign_in_required" || error?.code === "auth_not_configured";

interface CircleState {
  data?: CircleDetail;
  error?: ApiError;
  /** Which attempt the latest answer belongs to. */
  attempt: number;
  /** How many new things there were when the page first opened (the welcome-back line). */
  firstNew?: number;
  /** Items that were new on any load during this visit (so badges don't vanish on reload). */
  newIds: string[];
}

/**
 * One circle, reloaded on `reload()`. After each load it tells the server you've seen it up to
 * that moment, which is what "new since your last visit" counts from next time.
 */
export function useCircle(id: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CircleState>({ attempt: -1, newIds: [] });

  useEffect(() => {
    const ctrl = new AbortController();
    const url = `/api/circles/${encodeURIComponent(id)}`;
    getJson<CircleDetail>(url, ctrl.signal).then(
      (data) => {
        setState((s) => ({
          data,
          attempt,
          firstNew: s.firstNew ?? data.newSinceLastVisit,
          newIds: [
            ...new Set([...s.newIds, ...data.items.filter((i) => i.isNew).map((i) => i.id)]),
          ],
        }));
        void send("POST", `${url}/seen`, { seenAt: data.readAt }).catch(() => {});
      },
      (err: unknown) => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, error: asApiError(err), attempt }));
      },
    );
    return () => ctrl.abort();
  }, [id, attempt]);

  return {
    data: state.data,
    error: state.attempt === attempt ? state.error : undefined,
    loading: state.attempt !== attempt,
    firstNew: state.firstNew ?? 0,
    newIds: state.newIds,
    reload: () => setAttempt((n) => n + 1),
  };
}
