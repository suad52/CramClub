"use client";

import { useEffect } from "react";
import { LibraryClient } from "@/app/library/LibraryClient";
import { enterDemo } from "@/lib/demo/mode";

/** Demo mode on for this tab, then the library as usual (components/demo/DemoLayer.tsx runs it). */
export function DemoEntry() {
  useEffect(() => enterDemo(), []);
  return <LibraryClient />;
}
