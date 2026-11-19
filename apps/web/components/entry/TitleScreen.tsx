"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HAIR_STYLES, TOPS, labelOf } from "@ovr/shared";
import { useProfileStore } from "@/lib/avatar/profile";
import { useGameStore } from "@/lib/game/store";

interface MenuItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/**
 * The game-style title screen, drawn over the live library while the camera slowly circles
 * your character. Arrow keys + Enter work as well as the mouse.
 */
export function TitleScreen() {
  const ready = useGameStore((s) => s.ready);
  const phase = useGameStore((s) => s.phase);
  const setPhase = useGameStore((s) => s.setPhase);
  const openCreator = useGameStore((s) => s.openCreator);
  const setGuideOpen = useGameStore((s) => s.setGuideOpen);
  const name = useProfileStore((s) => s.displayName);
  const avatar = useProfileStore((s) => s.avatar);
  const savedAt = useProfileStore((s) => s.savedAt);
  const hasCharacter = savedAt !== null;
  const [focus, setFocus] = useState(0);

  const items: MenuItem[] = useMemo(
    () =>
      hasCharacter
        ? [
            {
              id: "enter",
              label: "Enter the Library",
              hint: `Continue as ${name}`,
              run: () => setPhase("entering"),
            },
            {
              id: "studio",
              label: "Character Studio",
              hint: "Change your look",
              run: () => openCreator("title"),
            },
            {
              id: "controls",
              label: "Controls",
              hint: "How to get around",
              run: () => setGuideOpen(true),
            },
          ]
        : [
            {
              id: "studio",
              label: "Create your character",
              hint: "Design how you'll look in the library",
              run: () => openCreator("title"),
            },
            {
              id: "controls",
              label: "Controls",
              hint: "How to get around",
              run: () => setGuideOpen(true),
            },
          ],
    [hasCharacter, name, setPhase, openCreator, setGuideOpen],
  );

  const visible = ready && phase === "title";
  const leaving = phase === "entering";

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (useGameStore.getState().guideOpen) return;
      if (e.key === "ArrowDown" || e.key === "s") setFocus((f) => (f + 1) % items.length);
      else if (e.key === "ArrowUp" || e.key === "w")
        setFocus((f) => (f - 1 + items.length) % items.length);
      else if (e.key === "Enter" || e.key === " ") {
        if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
        e.preventDefault();
        items[Math.min(focus, items.length - 1)]!.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, items, focus]);

  if (!ready || (phase !== "title" && phase !== "entering")) return null;
  const memberSince = savedAt
    ? new Date(savedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;

  return (
    <div
      className={`absolute inset-0 z-30 transition-opacity duration-700 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      {/* Warm vignette so the menu reads over the scene */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_55%,transparent_30%,rgb(28_18_12/0.55)_100%),linear-gradient(90deg,rgb(28_18_12/0.72)_0%,rgb(28_18_12/0.35)_38%,transparent_60%)]" />

      <div className="absolute top-0 bottom-0 left-0 flex w-full max-w-xl flex-col justify-center px-10 sm:px-16">
        <p
          className="title-rise text-xs font-extrabold tracking-[0.35em] text-lamp/90 uppercase"
          style={{ animationDelay: "80ms" }}
        >
          A cozy library to study together
        </p>
        <h1
          className="title-rise mt-2 font-display text-[clamp(4.5rem,11vw,8.5rem)] leading-[0.85] font-semibold text-cream drop-shadow-[0_6px_30px_rgb(0_0_0/0.45)]"
          style={{ animationDelay: "160ms" }}
        >
          OVR
        </h1>
        <div
          className="title-rise mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-ember to-lamp"
          style={{ animationDelay: "240ms" }}
        />

        <nav aria-label="Title menu" className="mt-10">
          <ul className="space-y-1.5">
            {items.map((it, i) => {
              const active = i === focus;
              return (
                <li
                  key={it.id}
                  className="title-rise"
                  style={{ animationDelay: `${320 + i * 90}ms` }}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setFocus(i)}
                    onFocus={() => setFocus(i)}
                    onClick={it.run}
                    className={`group relative flex w-full items-center gap-4 rounded-2xl py-3 pr-5 pl-6 text-left transition duration-200 focus-visible:outline-none ${active ? "bg-cream/12 shadow-[inset_0_0_0_1px_rgb(251_247_239/0.18)] backdrop-blur-sm" : "hover:bg-cream/5"}`}
                  >
                    <span
                      className={`absolute top-1/2 left-0 h-9 w-1.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-lamp to-ember transition-all duration-200 ${active ? "opacity-100" : "scale-y-0 opacity-0"}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block font-display text-2xl font-semibold transition ${active ? "text-cream" : "text-cream/70"}`}
                      >
                        {it.label}
                      </span>
                      <span
                        className={`block text-sm transition ${active ? "text-lamp/90" : "text-cream/40"}`}
                      >
                        {it.hint}
                      </span>
                    </span>
                    <span
                      className={`text-xl text-lamp transition duration-200 ${active ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`}
                      aria-hidden
                    >
                      →
                    </span>
                  </button>
                </li>
              );
            })}
            <li
              className="title-rise pt-2"
              style={{ animationDelay: `${320 + items.length * 90}ms` }}
            >
              <Link
                href="/"
                className="ml-6 text-sm font-bold text-cream/45 transition hover:text-cream/80"
              >
                ← Back to the front desk
              </Link>
            </li>
          </ul>
        </nav>

        <p
          className="title-rise title-glow mt-10 ml-6 flex items-center gap-2 text-xs font-bold text-cream/60"
          style={{ animationDelay: "800ms" }}
        >
          <span className="kbd !h-6 !min-w-6 !text-[0.7rem]">↑</span>
          <span className="kbd !h-6 !min-w-6 !text-[0.7rem]">↓</span>
          choose
          <span className="kbd ml-2 !h-6 !text-[0.7rem]">Enter</span>
          select
        </p>
      </div>

      {/* Library card */}
      <div
        className="title-rise absolute right-8 bottom-8 w-72 rotate-[1.5deg] rounded-2xl bg-[#fbf3e2]/95 p-4 text-ink shadow-[0_30px_60px_-25px_rgb(0_0_0/0.7)] ring-1 ring-ink/10"
        style={{ animationDelay: "500ms" }}
      >
        <div
          className="pointer-events-none absolute inset-2 rounded-xl border border-dashed border-wood/30"
          aria-hidden
        />
        <p className="text-[0.6rem] font-extrabold tracking-[0.22em] text-wood uppercase">
          Member card
        </p>
        {hasCharacter ? (
          <>
            <p className="mt-1 truncate font-[family-name:var(--font-caveat)] text-3xl leading-tight">
              {name}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              {labelOf(HAIR_STYLES, avatar.hair)} · {labelOf(TOPS, avatar.top)}
              {memberSince ? ` · since ${memberSince}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 font-display text-lg font-semibold">No card yet</p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Design your character to get one. It takes a minute.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
