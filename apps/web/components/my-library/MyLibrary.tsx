"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { TYPE_LABELS } from "@/components/librarian/parts";
import { type ApiError, useApi } from "@/components/progress/api";
import {
  IconBook,
  IconBookmark,
  IconCalendar,
  IconClock,
  IconPlay,
  IconRefresh,
  IconUser,
  IconWarning,
} from "@/components/ui/icons";
import { BODY, BODY_L, BTN, BTN_SM, DISPLAY_L, FOCUS, PAGE, PANEL } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { refreshAccount } from "@/lib/auth/useAccount";
import { removeItem, unsaveSource } from "@/lib/library/client";
import type { ContinueItem, LibraryItem, LibraryView } from "@/lib/library/types";
import { STATUS_LABELS } from "@/lib/librarian/types";
import { CloudLessons } from "@/components/lessons/CloudLessons";
import { CollectionsTab } from "./Collections";
import { CardSkeleton, ItemCard, SavedSourceCard } from "./Items";
import {
  EMPTY,
  IconLock,
  PrivateBadge,
  ProgressBar,
  TEXT_LINK,
  shortDate,
  useLibraryAccess,
} from "./parts";
import { SavedLessonPlayer } from "./SavedLessonPlayer";
import { TABS, type TabId } from "./tabs";

// A cloud lesson's page carries the player (browser audio and speech): client only, on demand.
const CloudLessonView = dynamic(
  () => import("@/components/lessons/CloudLessonView").then((m) => m.CloudLessonView),
  { ssr: false, loading: () => <Loading /> },
);

/** A decorative row of coloured dots, like the one under the title screen's logo. */
function DotRow({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="h-3 w-20 rounded-full border-[2.5px] border-walnut bg-tangerine shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-sun shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-leaf shadow-[0_3px_0_#1f1a16]" />
    </span>
  );
}

/** The page's title block (the same on every state, so nothing jumps once it loads). */
function Hero({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-[680px]">
        <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
          <IconLock size={14} />
          My library
        </p>
        <h1
          className={`${DISPLAY_L} title-pop mt-4 text-balance`}
          style={{ animationDelay: "80ms" }}
        >
          Your private shelf
        </h1>
        <DotRow className="title-pop mt-4" />
        <p className={`${BODY_L} mt-5 max-w-[62ch]`}>
          The sources, lessons, study plans and notes you keep, saved with your account. Only you
          can see them, on any computer you sign in on.
        </p>
      </div>
      {children}
    </div>
  );
}

/** A big centred card for the states before the library itself (signed out, not set up…). */
function StateCard({
  tone = "bg-sun",
  icon,
  title,
  children,
  role,
}: {
  tone?: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  role?: "alert";
}) {
  const uid = useId();
  return (
    <section
      role={role}
      aria-labelledby={uid}
      className={`${PANEL} relative mt-12 max-w-[640px] p-6 pt-9 sm:p-8 sm:pt-10`}
    >
      <span
        aria-hidden
        className={`absolute -top-6 left-6 grid h-12 w-12 -rotate-6 place-items-center rounded-[16px] border-[3px] border-walnut text-walnut shadow-[0_4px_0_#1f1a16] ${tone}`}
      >
        {icon}
      </span>
      <h2 id={uid} className="font-display text-[24px] leading-tight font-bold text-walnut">
        {title}
      </h2>
      <div className={`${BODY} mt-2`}>{children}</div>
    </section>
  );
}

function SignedOut() {
  return (
    <StateCard
      icon={<IconUser size={22} strokeWidth={2.25} />}
      title="Sign in to open your library"
    >
      <p>
        Your library keeps what you save from Ms. Fenwick and the Learning Studio with your account:
        sources, collections, lessons with your place in them, and your study history. Nobody else
        can open it.
      </p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <a href={loginHref("/my-library")} className={BTN.primary}>
          Sign in or make an account
        </a>
        <Link href="/librarian" className={BTN.secondary}>
          Keep studying without one
        </Link>
      </div>
    </StateCard>
  );
}

function NotSetUp() {
  return (
    <StateCard tone="bg-surface" icon={<IconLock size={22} />} title="Sign-in isn't set up yet">
      <p>
        Private libraries belong to an account, and sign-in hasn&apos;t been switched on for this
        server. Everything else works as before: lessons stay in this browser, and Ms. Fenwick keeps
        your requests.
      </p>
      <p className="mt-3 text-[13.5px] leading-5">
        Running OVR yourself? Add the Auth0 keys to apps/web/.env.local (docs/auth0.md explains
        where to find them), then restart the dev server.
      </p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <Link href="/learning-studio" className={BTN.secondary}>
          Open the Learning Studio
        </Link>
        <Link href="/librarian" className={BTN.secondary}>
          Ask the Librarian
        </Link>
      </div>
    </StateCard>
  );
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateCard
      role="alert"
      tone="bg-[#fbe9e5]"
      icon={<IconWarning size={22} className="text-danger" />}
      title="Your library didn't open"
    >
      <p>{message}</p>
      <div className="mt-5">
        <button type="button" className={BTN.primary} onClick={onRetry}>
          <IconRefresh size={18} />
          Try again
        </button>
      </div>
    </StateCard>
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Opening your library" className="mt-12 space-y-6">
      <div className="h-11 w-full max-w-[520px] animate-pulse rounded-full border-2 border-walnut/15 bg-surface motion-reduce:animate-none" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

/* ---- Pick up where you left off ---- */

function ContinueStrip({
  items,
  onPlay,
}: {
  items: ContinueItem[];
  onPlay: (collectionId: string, itemId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="continue" className="mt-10">
      <h2 id="continue" className="font-display text-[20px] font-semibold text-walnut">
        Pick up where you left off
      </h2>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((c) => (
          <li
            key={c.kind === "lesson" ? c.itemId : c.id}
            className="flex flex-col rounded-[20px] border-[2.5px] border-walnut bg-surface p-4 shadow-[0_4px_0_#1f1a16]"
          >
            <p className="flex items-center gap-1.5 font-display text-[13px] font-semibold text-ink-soft">
              {c.kind === "lesson" ? (
                <IconPlay size={14} strokeWidth={2.25} />
              ) : (
                <IconCalendar size={14} />
              )}
              {c.kind === "lesson" ? "Lesson in progress" : `Next in ${c.planTitle}`}
            </p>
            <p className="mt-1 line-clamp-2 font-display text-[16px] leading-6 font-semibold text-walnut">
              {c.title}
            </p>
            {c.kind === "lesson" ? (
              <>
                <p className="tabular mt-1 text-[13px] font-medium text-ink-soft">
                  Scene {c.scene + 1} of {c.scenes}
                </p>
                <ProgressBar value={c.scene / Math.max(1, c.scenes)} className="mt-2" />
                <div className="mt-auto pt-3">
                  <button
                    type="button"
                    className={BTN_SM.primary}
                    onClick={() => onPlay(c.collectionId, c.itemId)}
                  >
                    <IconPlay size={15} strokeWidth={2.25} />
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="tabular mt-1 text-[13px] font-medium text-ink-soft">
                  {shortDate(`${c.date}T12:00:00`)} · {c.minutes} min
                </p>
                <div className="mt-auto pt-3">
                  <Link href="/librarian" className={BTN_SM.secondary}>
                    Open the Librarian
                  </Link>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Tabs ---- */

const TAB = `inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-2 border-transparent px-4 font-display text-[15px] font-semibold text-ink-soft transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:border-walnut hover:bg-canvas hover:text-walnut motion-reduce:transition-none aria-selected:border-walnut aria-selected:bg-sun aria-selected:text-walnut aria-selected:shadow-[0_3px_0_#1f1a16] ${FOCUS}`;

function Tabs({
  tab,
  counts,
  onChange,
}: {
  tab: TabId;
  counts: Partial<Record<TabId, number>>;
  onChange: (tab: TabId) => void;
}) {
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const move = (to: number) => {
    const next = TABS[(to + TABS.length) % TABS.length]!.id;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Your library"
      className="flex flex-wrap gap-x-1.5 gap-y-2 pt-1 pb-1"
      onKeyDown={(e) => {
        const at = TABS.findIndex((t) => t.id === tab);
        if (e.key === "ArrowRight") move(at + 1);
        else if (e.key === "ArrowLeft") move(at - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(TABS.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {TABS.map((t) => {
        const n = counts[t.id];
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={TAB}
          >
            {t.label}
            {n !== undefined && (
              <span className="tabular inline-grid h-6 min-w-6 place-items-center rounded-full border-2 border-walnut bg-surface px-1.5 text-[12.5px] leading-none font-bold text-walnut">
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SavedPanel({ view, onChanged }: { view: LibraryView; onChanged: () => void }) {
  if (view.saved.length === 0)
    return (
      <div className={EMPTY}>
        <p>
          Nothing saved yet. When Ms. Fenwick finds sources for you, press Save on the ones worth
          keeping and they&apos;ll wait for you here.
        </p>
        <Link href="/librarian" className={`${BTN_SM.secondary} mt-3`}>
          Ask the Librarian
        </Link>
      </div>
    );
  return (
    <ul className="max-w-[820px] space-y-6">
      {view.saved.map((s) => (
        <li key={s.id}>
          <SavedSourceCard source={s} onRemove={() => unsaveSource(s.id).then(onChanged)} />
        </li>
      ))}
    </ul>
  );
}

function LessonsPanel({
  view,
  onPlay,
  onChanged,
  onOpenCloud,
}: {
  view: LibraryView;
  onPlay: (item: LibraryItem) => void;
  onChanged: () => void;
  onOpenCloud: (id: string) => void;
}) {
  return (
    <div className="space-y-12">
      <CloudLessons onOpen={onOpenCloud} />
      <section aria-labelledby="saved-lessons" className="space-y-4">
        <h3 id="saved-lessons" className="font-display text-[19px] font-semibold text-walnut">
          Saved from the Learning Studio
        </h3>
        <SavedLessons view={view} onPlay={onPlay} onChanged={onChanged} />
      </section>
    </div>
  );
}

function SavedLessons({
  view,
  onPlay,
  onChanged,
}: {
  view: LibraryView;
  onPlay: (item: LibraryItem) => void;
  onChanged: () => void;
}) {
  if (view.lessons.length === 0)
    return (
      <div className={`${EMPTY} max-w-[820px]`}>
        <p>
          No lessons kept here yet. In the Learning Studio, press Save to my library under a lesson
          and it&apos;ll be here on any computer, with your place in it.
        </p>
        <Link href="/learning-studio" className={`${BTN_SM.secondary} mt-3`}>
          Open the Learning Studio
        </Link>
      </div>
    );
  return (
    <ul className="max-w-[820px] space-y-6">
      {view.lessons.map((item) => (
        <li key={item.id}>
          <ItemCard
            item={item}
            showCollection
            onPlay={onPlay}
            onChanged={onChanged}
            onRemove={() => removeItem(item.collectionId, item.id).then(onChanged)}
          />
        </li>
      ))}
    </ul>
  );
}

function HistoryPanel({ view }: { view: LibraryView }) {
  const { tasks, lessons } = view.history;
  const ROW =
    "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b-2 border-dashed border-walnut/15 py-3 last:border-b-0";
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      <section aria-labelledby="history-requests">
        <h3 id="history-requests" className="font-display text-[19px] font-semibold text-walnut">
          Your requests to Ms. Fenwick
        </h3>
        {tasks.length === 0 ? (
          <p className={`${EMPTY} mt-3`}>No requests yet.</p>
        ) : (
          <ul className="mt-2">
            {tasks.map((t) => (
              <li key={t.id} className={ROW}>
                <span className="min-w-0">
                  <span className="block font-display text-[16px] font-semibold break-words text-walnut">
                    {t.topic || "A request"}
                  </span>
                  <span className="text-[13px] font-medium text-ink-soft">
                    {TYPE_LABELS[t.type] ?? "Request"} · {STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </span>
                <span className="tabular shrink-0 font-display text-[13px] font-medium text-ink-soft">
                  {shortDate(t.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {tasks.length > 0 && (
          <Link href="/librarian" className={`${TEXT_LINK} mt-3 inline-block text-[14px]`}>
            Reopen one in the Librarian
          </Link>
        )}
      </section>
      <section aria-labelledby="history-lessons">
        <h3 id="history-lessons" className="font-display text-[19px] font-semibold text-walnut">
          Lessons you&apos;ve played
        </h3>
        {lessons.length === 0 ? (
          <p className={`${EMPTY} mt-3`}>No lessons played yet.</p>
        ) : (
          <ul className="mt-2">
            {lessons.map((l) => (
              <li key={l.lessonId} className={ROW}>
                <span className="min-w-0">
                  <span className="block font-display text-[16px] font-semibold break-words text-walnut">
                    {l.title}
                  </span>
                  <span className="text-[13px] font-medium text-ink-soft">
                    {l.subject ? `${l.subject} · ` : ""}
                    {l.event === "completed" ? "Finished" : "Started"}
                  </span>
                </span>
                <span className="tabular shrink-0 font-display text-[13px] font-medium text-ink-soft">
                  {shortDate(l.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[13px] leading-5 font-medium text-ink-soft lg:col-span-2">
        History comes from what you&apos;ve done while signed in, plus anything from before on the
        browser where you first signed in.
      </p>
    </div>
  );
}

/* ---- The page ---- */

function errorMessage(error: ApiError) {
  return error.code === "network"
    ? "Couldn't reach the library's server. Check your connection and try again."
    : error.message;
}

export function MyLibrary({ initialTab }: { initialTab: TabId }) {
  const access = useLibraryAccess();
  const { data, error, loading, reload } = useApi<LibraryView>(
    access === "signed-in" ? "/api/me/library" : null,
  );
  const [tab, setTab] = useState<TabId>(initialTab);
  const [playing, setPlaying] = useState<{ collectionId: string; itemId: string } | null>(null);
  const [cloudLesson, setCloudLesson] = useState<string | null>(null);

  const changeTab = (next: TabId) => {
    setTab(next);
    try {
      window.history.replaceState(window.history.state, "", `?tab=${next}`);
    } catch {
      // Some embedded browsers refuse history changes: the tab still switches.
    }
  };

  if (playing)
    return (
      <SavedLessonPlayer
        collectionId={playing.collectionId}
        itemId={playing.itemId}
        onExit={() => {
          setPlaying(null);
          reload();
        }}
      />
    );

  if (cloudLesson) return <CloudLessonView id={cloudLesson} onExit={() => setCloudLesson(null)} />;

  const play = (collectionId: string, itemId: string) => {
    setPlaying({ collectionId, itemId });
    window.scrollTo({ top: 0 });
  };

  let body: React.ReactNode;
  if (access === "loading") body = <Loading />;
  else if (access === "error")
    body = (
      <Problem
        message="Couldn't check whether you're signed in."
        onRetry={() => void refreshAccount()}
      />
    );
  else if (access === "off" || error?.code === "auth_not_configured") body = <NotSetUp />;
  else if (access === "signed-out" || error?.code === "sign_in_required") body = <SignedOut />;
  else if (error?.code === "not_configured" && !data)
    body = (
      <Problem
        message="Personal libraries need the database, and it isn't set up on this server (DATABASE_URL, see docs/learning-analytics.md)."
        onRetry={reload}
      />
    );
  else if (error && !data) body = <Problem message={errorMessage(error)} onRetry={reload} />;
  else if (!data) body = <Loading />;
  else
    body = (
      <>
        {data.lastTopic && (
          <p className="mt-8 flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border-[2.5px] border-walnut bg-[#fdf1d6] px-4 py-3 text-[15px] leading-6 font-medium text-walnut shadow-[0_3px_0_#1f1a16]">
            <IconBook size={18} strokeWidth={2.25} />
            <span className="min-w-0 flex-1">
              Welcome back, {data.displayName}. Last time you asked Ms. Fenwick about{" "}
              <span className="font-display font-semibold">{data.lastTopic}</span>.
            </span>
            <Link href="/librarian" className={BTN_SM.secondary}>
              Ask her more
            </Link>
          </p>
        )}
        <ContinueStrip items={data.continue} onPlay={play} />
        <div className="mt-10">
          <Tabs
            tab={tab}
            onChange={changeTab}
            counts={{
              saved: data.saved.length,
              collections: data.collections.length,
              lessons: data.lessons.length,
            }}
          />
          {loading && (
            <span role="status" className="sr-only">
              Refreshing your library
            </span>
          )}
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            tabIndex={0}
            className="mt-6 rounded-[20px] outline-none focus-visible:ring-4 focus-visible:ring-sun"
          >
            {tab === "saved" && <SavedPanel view={data} onChanged={reload} />}
            {tab === "collections" && (
              <CollectionsTab
                collections={data.collections}
                onChanged={reload}
                onPlay={(item) => play(item.collectionId, item.id)}
              />
            )}
            {tab === "lessons" && (
              <LessonsPanel
                view={data}
                onChanged={reload}
                onPlay={(item) => play(item.collectionId, item.id)}
                onOpenCloud={(id) => {
                  setCloudLesson(id);
                  window.scrollTo({ top: 0 });
                }}
              />
            )}
            {tab === "history" && <HistoryPanel view={data} />}
          </div>
        </div>
      </>
    );

  return (
    <div className="relative min-h-dvh bg-canvas">
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>
      <SiteHeader current="/my-library" />
      <main id="main" className={`${PAGE} pt-10 pb-20 sm:pt-14 sm:pb-24`}>
        <Hero>
          {data && (
            <div className="flex w-full max-w-[320px] -rotate-1 flex-col gap-2 rounded-[20px] border-[3px] border-walnut bg-surface p-4 shadow-[0_5px_0_#1f1a16] sm:w-auto">
              <p className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[2.5px] border-walnut bg-leaf font-display text-[17px] font-bold text-walnut uppercase"
                >
                  {data.displayName.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[13px] font-medium text-ink-soft">
                    Signed in as
                  </span>
                  <span className="block truncate font-display text-[17px] font-semibold text-walnut">
                    {data.displayName}
                  </span>
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-soft">
                <PrivateBadge />
                <span className="flex items-center gap-1">
                  <IconBookmark size={14} />
                  <span className="tabular">
                    {data.saved.length + data.collections.reduce((n, c) => n + c.itemCount, 0)}
                  </span>{" "}
                  kept
                </span>
                <span className="flex items-center gap-1">
                  <IconClock size={14} />
                  {data.history.tasks[0]
                    ? `Last request ${shortDate(data.history.tasks[0].createdAt)}`
                    : "No requests yet"}
                </span>
              </p>
            </div>
          )}
        </Hero>
        {body}
      </main>
    </div>
  );
}
