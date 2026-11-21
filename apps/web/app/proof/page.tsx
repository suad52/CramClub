import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { DotRow } from "@/components/progress/ui";
import { BODY_L, BTN_SM, DISPLAY_L, PAGE } from "@/components/ui/styles";
import { ProofView } from "./ProofView";

/*
 * /proof ("How it works"): for the sponsor judges, what runs where and the live evidence for it,
 * read from this server's own database, storage and game server (GET /api/proof, built in
 * lib/proof/server.ts; the ticket replay test runs from the viewer's browser, lib/proof/replay.ts).
 * Read-only, nothing secret, nothing that identifies a student.
 */

export const metadata: Metadata = {
  title: "How it works · Cram Club",
  description:
    "What runs where in Cram Club, with live evidence: Vultr, Tiger Data, Auth0, ElevenLabs, Gemini and TinyFish.",
};

export default function ProofPage() {
  return (
    <div className="relative min-h-dvh bg-canvas">
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>

      <SiteHeader current="/proof" />

      <main id="main" className={`${PAGE} pt-10 pb-16 sm:pt-14 sm:pb-20`}>
        <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-tangerine"
          />
          For the judges
        </p>
        <h1 className={`${DISPLAY_L} mt-5`}>How Cram Club works</h1>
        <DotRow className="mt-4" />
        <p className={`${BODY_L} mt-4 max-w-[64ch]`}>
          What runs where, and the evidence, live: every number below was just read from this
          server&apos;s own database, storage bucket and game server. Nothing here is secret, and
          nothing identifies a student.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-3">
          {/* The judge demo (lib/demo): one tab, seated at a table with quick timers. */}
          <Link href="/demo" className={BTN_SM.primary}>
            Try the 60-second demo
          </Link>
          <span className="text-[13.5px] font-medium text-ink-soft">
            Walk straight in, sit at a table and run a 1-minute pomodoro.
          </span>
        </p>
        <div className="mt-8 sm:mt-10">
          <ProofView />
        </div>
      </main>
    </div>
  );
}
