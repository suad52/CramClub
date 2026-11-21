"use client";

import { create } from "zustand";
import { demoFlagFrom } from "./settings";

/*
 * Whether the judge demo is on, for this browser tab only (sessionStorage: it survives reloads
 * and a sign-in round trip in the same tab, never another tab or a later visit). Turned on by
 * /demo, or ?demo=1 on the library; off from the demo ribbon's "Exit demo", or ?demo=0. What it
 * changes is in lib/demo/settings.ts; every reader checks isDemoOn() (or useDemo) so that with it
 * off nothing behaves differently.
 */

const KEY = "ovr.demo";

function read(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(KEY, "1");
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked (a private window, say): demo mode lasts until the page reloads.
  }
}

interface DemoStore {
  on: boolean;
  /** The demo controls are open (they fold away to a button on the ribbon). */
  panelOpen: boolean;
}

/** The controls start open on a wide screen; on a narrow one they'd cover the timer's cards. */
const wide = () => typeof window === "undefined" || window.innerWidth >= 1180;

export const useDemo = create<DemoStore>(() => ({ on: read(), panelOpen: wide() }));

export const isDemoOn = () => useDemo.getState().on;

export function enterDemo() {
  write(true);
  if (!useDemo.getState().on) useDemo.setState({ on: true, panelOpen: wide() });
}

/** Turns demo mode off for this tab (the caller reloads, so everything starts fresh). */
export function leaveDemo() {
  write(false);
  useDemo.setState({ on: false });
}

/** ?demo=1 / ?demo=0 on the current URL turns it on or off (and returns whether it said so). */
export function demoFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const flag = demoFlagFrom(window.location.search);
  if (flag === true) enterDemo();
  else if (flag === false) leaveDemo();
  return flag !== null;
}
