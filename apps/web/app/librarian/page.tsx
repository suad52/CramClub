import type { Metadata } from "next";
import { LibrarianPanel } from "@/components/librarian/LibrarianPanel";

export const metadata: Metadata = { title: "Ask the Librarian · OVR" };

/** The AI Librarian on her own page: for small screens, and for anyone not in the 3D library. */
export default function LibrarianPage() {
  return (
    <div className="h-dvh bg-parchment sm:p-6">
      <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden bg-parchment sm:rounded-3xl sm:shadow-[0_30px_80px_-30px_rgb(20_12_6/0.35)] sm:ring-1 sm:ring-ink/10">
        <LibrarianPanel context="page" />
      </div>
    </div>
  );
}
