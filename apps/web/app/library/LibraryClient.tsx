"use client";

import dynamic from "next/dynamic";

// The 3D experience touches window/WebGL, so it only ever renders in the browser.
const LibraryExperience = dynamic(() => import("@/components/library/LibraryExperience"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-parchment">
      <p className="font-display text-2xl font-semibold">Opening the library…</p>
    </div>
  ),
});

export function LibraryClient() {
  return <LibraryExperience />;
}
