import type { Metadata } from "next";
import Link from "next/link";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";

export const metadata: Metadata = { title: "My Progress · OVR" };

export default function ProgressPage() {
  return (
    <div className="min-h-dvh bg-parchment">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
          OVR
        </Link>
        <Link
          href="/library"
          className="rounded-full px-4 py-2 text-sm font-bold text-ink-soft hover:bg-ink/5 hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
        >
          ← Back to the library
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <p className="mb-2 text-sm font-bold tracking-[0.18em] text-wood uppercase">My Progress</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Your study record.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Focus time, lessons and knowledge checks, counted from what you&apos;ve actually done in
          the library.
        </p>
        <div className="mt-8">
          <ProgressDashboard context="page" />
        </div>
      </main>
    </div>
  );
}
