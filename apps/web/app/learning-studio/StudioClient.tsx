"use client";

import dynamic from "next/dynamic";

// Lessons live in this browser (localStorage) and narration uses browser audio: client only.
const Studio = dynamic(() => import("@/components/learning-studio/Studio"), { ssr: false });

export function StudioClient() {
  return <Studio />;
}
