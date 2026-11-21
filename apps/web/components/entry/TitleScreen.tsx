"use client";

import { useEffect, useMemo, useState } from "react";
import { HAIR_STYLES, TOPS, labelOf } from "@ovr/shared";
import { useProfileStore } from "@/lib/avatar/profile";
import { useGameStore } from "@/lib/game/store";
import { LOGOUT_HREF, loginHref } from "@/lib/auth/links";
import { refreshAccount, useAccount } from "@/lib/auth/useAccount";
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconRefresh,
} from "@/components/ui/icons";

interface MenuItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/**
 * The game-style title screen, drawn over the live library while the camera slowly circles
 * your character. Arrow keys + Enter work as well as the mouse. Under the name it says what Cram
 * Club is for: studying next to real people so starting is easier (body doubling).
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
              // Through the camera and microphone check first (components/entry/DeviceSetup.tsx).
              run: () => setPhase("setup"),
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
        if ((e.target as HTMLElement | null)?.closest("button, a")) return;
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

  // Cartoon kit: flat colours, thick walnut outlines and hard "sticker" shadows.
  const CHUNKY = "border-[3px] border-walnut";
  const KEY =
    "inline-flex h-7 min-w-7 items-center justify-center rounded-[9px] border-2 border-walnut bg-cream px-1.5 font-[family-name:var(--font-cartoon)] text-[0.8rem] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]";

  return (
    <div
      className={`absolute inset-0 z-30 font-[family-name:var(--font-cartoon)] transition-opacity duration-700 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      {/* Warm vignette so the menu reads over the scene */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_55%,transparent_30%,rgb(28_18_12/0.55)_100%),linear-gradient(90deg,rgb(28_18_12/0.72)_0%,rgb(28_18_12/0.35)_38%,transparent_60%)]" />

      <div className="absolute top-0 bottom-0 left-0 flex w-full max-w-xl flex-col justify-center px-10 sm:px-16">
        <p
          className={`title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full ${CHUNKY} bg-lamp px-4 py-1.5 text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]`}
          style={{ animationDelay: "80ms" }}
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-[#e07a3f]"
          />
          A cozy library to study together
        </p>
        <h1
          className="title-pop mt-4 text-[clamp(4rem,9vw,6.75rem)] leading-[0.88] font-bold tracking-tight text-cream [paint-order:stroke_fill] [text-shadow:0_9px_0_#1f1a16] [-webkit-text-stroke:11px_#1f1a16]"
          style={{ animationDelay: "160ms" }}
        >
          <span className="block">Cram</span>
          <span className="block">Club</span>
        </h1>
        <div
          className="title-pop mt-5 flex items-center gap-2"
          style={{ animationDelay: "240ms" }}
          aria-hidden
        >
          <span className="h-3 w-24 rounded-full border-[2.5px] border-walnut bg-[#e07a3f] shadow-[0_3px_0_#1f1a16]" />
          <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-lamp shadow-[0_3px_0_#1f1a16]" />
          <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-[#7fb27a] shadow-[0_3px_0_#1f1a16]" />
        </div>
        <p
          className="title-pop mt-5 max-w-md text-[1.15rem] leading-snug font-semibold text-cream/90 [text-shadow:0_2px_0_#1f1a16]"
          style={{ animationDelay: "280ms" }}
        >
          Study next to real people, so starting feels easier.{" "}
          <span className="text-lamp">That&apos;s body doubling.</span>
        </p>

        <nav aria-label="Title menu" className="mt-8">
          <ul className="space-y-3.5">
            {items.map((it, i) => {
              const active = i === focus;
              return (
                <li
                  key={it.id}
                  className="title-pop"
                  style={{ animationDelay: `${320 + i * 90}ms` }}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setFocus(i)}
                    onFocus={() => setFocus(i)}
                    onClick={it.run}
                    className={`group relative flex w-full items-center gap-4 rounded-[22px] ${CHUNKY} py-3 pr-4 pl-6 text-left transition-[transform,box-shadow,background-color] duration-150 ease-out outline-none focus-visible:ring-4 focus-visible:ring-lamp/80 active:translate-y-[3px] motion-reduce:transition-none ${active ? "-translate-y-0.5 bg-cream text-walnut shadow-[0_7px_0_#1f1a16] active:shadow-[0_3px_0_#1f1a16]" : "bg-walnut/60 text-cream shadow-[0_4px_0_rgb(0_0_0/0.55)] hover:bg-walnut/75"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.6rem] leading-tight font-semibold">
                        {it.label}
                      </span>
                      <span
                        className={`block text-[0.95rem] font-medium ${active ? "text-walnut/70" : "text-cream/65"}`}
                      >
                        {it.hint}
                      </span>
                    </span>
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-[2.5px] border-walnut bg-lamp text-walnut shadow-[0_3px_0_#1f1a16] transition duration-200 motion-reduce:transition-none ${active ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-45 opacity-0"}`}
                      aria-hidden
                    >
                      <IconArrowRight size={20} strokeWidth={2.75} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <p
          className="title-pop mt-9 ml-2 flex items-center gap-2 text-[0.95rem] font-semibold text-cream/75"
          style={{ animationDelay: "800ms" }}
        >
          <span className={KEY} aria-hidden>
            <IconArrowUp size={14} strokeWidth={3} />
          </span>
          <span className={KEY} aria-hidden>
            <IconArrowDown size={14} strokeWidth={3} />
          </span>
          choose
          <span className={`${KEY} ml-2`}>Enter</span>
          select
        </p>
      </div>

      {/* Library card */}
      <div className="title-pop absolute right-8 bottom-8" style={{ animationDelay: "500ms" }}>
        <div
          className={`title-bob relative w-76 rotate-[2.5deg] rounded-[24px] ${CHUNKY} bg-[#fbf3e2] p-5 pt-6 text-walnut shadow-[0_9px_0_#1f1a16]`}
        >
          <div
            className="pointer-events-none absolute inset-2.5 rounded-[16px] border-2 border-dashed border-walnut/25"
            aria-hidden
          />
          <p className="absolute -top-4 left-5 rounded-full border-[2.5px] border-walnut bg-[#e07a3f] px-3 py-0.5 text-[0.8rem] font-semibold text-cream shadow-[0_3px_0_#1f1a16]">
            Member card
          </p>
          <span
            aria-hidden
            className="absolute -top-4 -right-4 grid h-14 w-14 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-lamp text-[0.95rem] font-bold text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            CC
          </span>
          {hasCharacter ? (
            <>
              <p className="relative truncate pr-8 font-[family-name:var(--font-caveat)] text-[2.1rem] leading-tight">
                {name}
              </p>
              <p className="relative mt-1 text-sm font-medium text-walnut/70">
                {labelOf(HAIR_STYLES, avatar.hair)} · {labelOf(TOPS, avatar.top)}
                {memberSince ? ` · since ${memberSince}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="relative text-xl font-semibold">No card yet</p>
              <p className="relative mt-1 text-sm font-medium text-walnut/70">
                Design your character to get one. It takes a minute.
              </p>
            </>
          )}
          <CardAccount />
        </div>
      </div>
    </div>
  );
}

/**
 * The member card's account line: who's signed in (with "Sign out"), or "Sign in to keep your
 * library". Until Auth0 is set up it says so, disabled. Sign-in leaves the page and comes back here.
 */
function CardAccount() {
  const { status, account } = useAccount();
  const ROW = "relative mt-4 border-t-2 border-dashed border-walnut/20 pt-3";

  if (status === "loading") return <div aria-hidden className={`${ROW} h-[3.25rem]`} />;

  if (status === "error")
    return (
      <div className={`${ROW} flex items-center justify-between gap-3`}>
        <p className="text-sm font-semibold text-walnut/75">Couldn&apos;t check sign-in</p>
        <button
          type="button"
          onClick={() => void refreshAccount()}
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border-2 border-walnut bg-cream px-2.5 text-[0.85rem] font-semibold text-walnut shadow-[0_2px_0_#1f1a16] outline-none hover:bg-lamp focus-visible:ring-4 focus-visible:ring-lamp/80 active:translate-y-[2px] active:shadow-none"
        >
          <IconRefresh size={14} strokeWidth={2.5} />
          Try again
        </button>
      </div>
    );

  if (!account.configured)
    return (
      <div className={ROW}>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby="card-signin-hint"
          className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-[14px] border-[2.5px] border-dashed border-walnut/45 px-3 text-[0.95rem] font-semibold text-walnut/70 outline-none focus-visible:ring-4 focus-visible:ring-lamp/80"
        >
          Sign-in isn&apos;t set up yet
        </button>
        <p id="card-signin-hint" className="mt-1.5 text-[0.8rem] font-medium text-walnut/70">
          Your progress stays in this browser for now.
        </p>
      </div>
    );

  if (!account.signedIn)
    return (
      <div className={ROW}>
        <a
          href={loginHref("/")}
          className="group flex h-10 w-full items-center justify-between gap-2 rounded-[14px] border-[2.5px] border-walnut bg-lamp pr-2 pl-3.5 text-[0.95rem] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] transition-transform duration-150 outline-none hover:-translate-y-px focus-visible:ring-4 focus-visible:ring-lamp/80 active:translate-y-[2px] active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none"
        >
          Sign in to keep your library
          <IconArrowRight size={18} strokeWidth={2.75} />
        </a>
      </div>
    );

  return (
    <div className={`${ROW} flex items-center gap-2`}>
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-walnut bg-[#7fb27a] text-walnut"
      >
        <IconCheck size={14} strokeWidth={3} />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">
        Signed in as {account.displayName ?? "you"}
      </p>
      <a
        href={LOGOUT_HREF}
        className="shrink-0 rounded-[8px] px-1 text-sm font-semibold text-walnut/75 underline decoration-2 underline-offset-2 outline-none hover:text-walnut focus-visible:ring-4 focus-visible:ring-lamp/80"
      >
        Sign out
      </a>
    </div>
  );
}
