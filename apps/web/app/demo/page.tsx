import type { Metadata } from "next";
import { DemoEntry } from "./DemoEntry";

/*
 * /demo: the judge demo's deep link (also /library?demo=1, or ?demo=1 on the home page). It turns
 * demo mode on for this browser tab and opens the library straight at a table: quick timers, a
 * demo study buddy and the demo controls (lib/demo/). "Exit demo" on its ribbon turns it off.
 */

export const metadata: Metadata = {
  title: "Demo · Cram Club",
  description:
    "Cram Club's quick demo: walk straight in, sit at a table and run a 1-minute pomodoro next to a study buddy.",
};

export default function DemoPage() {
  return <DemoEntry />;
}
