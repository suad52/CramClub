import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LibraryTestClient } from "./LibraryTestClient";

export const metadata: Metadata = { title: "Library model test · Cram Club" };

/** Dev-only: loads the Blender-built library GLB to measure how it runs in the browser. */
export default function LibraryTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LibraryTestClient />;
}
