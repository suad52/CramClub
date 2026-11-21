import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { DotRow } from "@/components/progress/ui";
import { BODY_L, BTN_SM, DISPLAY_L, PAGE } from "@/components/ui/styles";

export const metadata: Metadata = { title: "My progress · OVR" };

export default function ProgressPage() {
  return (
    <div className="relative min-h-dvh bg-canvas">
      {/* Sits above the page until a keyboard user tabs to it. */}
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>

      <SiteHeader current="/progress" />

      <main id="main" className={`${PAGE} pt-10 pb-16 sm:pt-14 sm:pb-20`}>
        {/* A tilted sun badge over the title, like the title screen's tagline. */}
        <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-tangerine"
          />
          Your study record
        </p>
        <h1 className={`${DISPLAY_L} mt-5`}>My progress</h1>
        <DotRow className="mt-4" />
        <p className={`${BODY_L} mt-4 max-w-[60ch]`}>
          Your study record: focus time, lessons and knowledge checks, counted from what you&apos;ve
          actually done in the library.
        </p>
        <div className="mt-8 sm:mt-10">
          <ProgressDashboard context="page" />
        </div>
      </main>
    </div>
  );
}
