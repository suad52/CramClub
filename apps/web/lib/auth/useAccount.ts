"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { AccountInfo } from "./types";

/**
 * The browser's view of sign-in, from GET /api/account (no tokens or secrets reach the page).
 * One request per page load, shared by every component that asks; `refresh()` asks again.
 */
export type AccountState =
  | { status: "loading"; account: null }
  | { status: "ready"; account: AccountInfo }
  | { status: "error"; account: null };

const useAccountStore = create<AccountState>(() => ({ status: "loading", account: null }));

let inflight: Promise<void> | null = null;

function parse(body: unknown): AccountInfo | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.configured !== "boolean" || typeof b.signedIn !== "boolean") return null;
  return {
    configured: b.configured,
    signedIn: b.signedIn,
    displayName: typeof b.displayName === "string" ? b.displayName : null,
  };
}

function load(force = false) {
  if (inflight && !force) return inflight;
  inflight = fetch("/api/account", { cache: "no-store", credentials: "same-origin" })
    .then(async (res) => {
      const account = res.ok ? parse(await res.json()) : null;
      if (!account) throw new Error(`account ${res.status}`);
      useAccountStore.setState({ status: "ready", account });
    })
    .catch(() => {
      useAccountStore.setState({ status: "error", account: null });
      inflight = null; // let the next component (or refresh) try again
    });
  return inflight;
}

/** Ask the server again (after something that changes who's signed in). */
export function refreshAccount() {
  return load(true);
}

/** Sign-in state for the UI: loading, ready (with the account) or error. */
export function useAccount(): AccountState {
  const state = useAccountStore();
  useEffect(() => {
    void load();
  }, []);
  return state;
}
