import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { LibrarianPanel } from "@/components/librarian/LibrarianPanel";
import { BTN_SM } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Ask the Librarian · OVR" };

/**
 * The AI Librarian on her own page: for small screens, and for anyone not in the 3D library. Her
 * desk is a full-height reading column on the canvas (a cream sticker card on wider screens), the
 * same width as her panel over the library.
 */
export default function LibrarianPage() {
  return (
    <div className="relative flex h-dvh flex-col bg-canvas">
      {/* Sits above the page until a keyboard user tabs to it. */}
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>

      <SiteHeader current="/librarian" />

      <main id="main" className="flex min-h-0 flex-1 flex-col sm:px-6 sm:pt-5 sm:pb-7">
        <div className="mx-auto flex min-h-0 w-full max-w-[808px] flex-1 flex-col overflow-hidden bg-surface sm:rounded-[24px] sm:border-[3px] sm:border-walnut sm:shadow-[0_6px_0_#1f1a16]">
          <LibrarianPanel context="page" />
        </div>
      </main>
    </div>
  );
}
