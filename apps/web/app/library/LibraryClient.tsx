"use client";

import dynamic from "next/dynamic";

// The 3D experience touches window/WebGL, so it only ever renders in the browser.
const LibraryExperience = dynamic(() => import("@/components/library/LibraryExperience"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-canvas px-4">
      <div className="flex flex-col items-center text-center">
        <p
          aria-hidden
          className="font-display text-[64px] leading-[0.9] font-bold tracking-tight text-surface [paint-order:stroke_fill] [text-shadow:0_7px_0_#1f1a16] [-webkit-text-stroke:10px_#1f1a16]"
        >
          <span className="block">Cram</span>
          <span className="block">Club</span>
        </p>
        <p className="mt-8 font-display text-[19px] leading-6 font-semibold text-walnut">
          Opening the library…
        </p>
      </div>
    </div>
  ),
});

export function LibraryClient() {
  return <LibraryExperience />;
}
