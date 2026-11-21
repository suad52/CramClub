"use client";

import dynamic from "next/dynamic";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { PAGE } from "@/components/ui/styles";

/** What shows while the studio's code loads: the page's own header, so nothing jumps after. */
function StudioLoading() {
  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader current="/learning-studio" />
      <main className={`${PAGE} pt-10 sm:pt-14`}>
        <p
          role="status"
          className="inline-flex -rotate-2 items-center gap-2.5 rounded-full border-[3px] border-walnut bg-surface px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]"
        >
          <span
            aria-hidden
            className="h-3.5 w-3.5 rounded-full border-[3px] border-walnut/20 border-t-tangerine motion-safe:animate-spin"
          />
          Opening the Learning Studio…
        </p>
      </main>
    </div>
  );
}

// Lessons live in this browser (localStorage) and narration uses browser audio: client only.
const Studio = dynamic(() => import("@/components/learning-studio/Studio"), {
  ssr: false,
  loading: StudioLoading,
});

export function StudioClient() {
  return <Studio />;
}
