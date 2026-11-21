import type { ReactNode } from "react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { BTN_SM, PAGE } from "@/components/ui/styles";

/** The frame every Study Circle page shares: skip link, the site header, one content column. */
export function CirclesShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-canvas">
      {/* Sits above the page until a keyboard user tabs to it. */}
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>
      <SiteHeader current="/circles" />
      <main id="main" className={`${PAGE} pt-8 pb-16 sm:pt-12 sm:pb-20`}>
        {children}
      </main>
    </div>
  );
}

/** The tilted sun badge over a page title (like the title screen's tagline). */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-tangerine" />
      {children}
    </p>
  );
}
