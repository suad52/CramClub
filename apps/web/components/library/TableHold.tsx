"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconPlus,
  IconUsers,
} from "@/components/ui/icons";
import { BODY, BTN, FOCUS, HUD_CHIP, HUD_MUTED, PANEL, RIBBON } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { getSeat, isBoardOpen, setTimerPanelOpen, standUp } from "@/lib/game/actions";
import { requestPointerLock } from "@/lib/game/pointer";
import { formatClock } from "@/lib/game/pomodoro";
import { useGameStore } from "@/lib/game/store";
import { isLessonOverlayOpen } from "@/lib/learning-studio/boardLessons";
import {
  HOLD_NOUN,
  HOLD_TEXT,
  claimTable,
  clearTableError,
  clockTime,
  dismissInvitation,
  dismissOffer,
  dismissReserved,
  dismissTimeUp,
  highlightInvitation,
  holdKey,
  cancelLeave,
  invitationKey,
  inviteByEmail,
  loadCircles,
  makeInvite,
  pendingInvitation,
  refreshTables,
  releaseTable,
  removeEmailInvite,
  setCircle,
  setVisibility,
  tableName,
  useTables,
  useTablesLive,
} from "@/lib/tables/client";
import { msLeft } from "@/lib/tables/time";
import {
  EMAIL_INVITES_PER_HOLD,
  type TableInvitation,
  type TableStatus,
  WARN_MINUTES,
} from "@/lib/tables/types";

/*
 * Holding a table, like in a real library (rules: lib/tables/types.ts, the server decides).
 *
 * - Sit at a free table and a cream card offers to hold it for an hour, open to everyone or
 *   private (sign-in needed). Choosing private asks who can join: an invite link, the emails
 *   people signed up with, and, if you like, the members of one of your Study Circles.
 * - While you hold one, a compact walnut panel (the timer card's look) sits top right: the time
 *   left, open or private, who can join, and "Give up table".
 * - A word 5 minutes before the end, and a quiet "time's up" card when it ends. Neither stands
 *   you up or touches a pomodoro.
 * - A private table you can't use says whose it is and until when, instead of sitting you down.
 * - Someone invited your verified email to their private table: a card says who, which table and
 *   until when, and "Show me" highlights the table's name (it doesn't walk you anywhere).
 *
 * Cards never take the mouse: with it captured, hold Shift to use their buttons (like the timer's
 * cards). Esc closes the top one while the mouse is free.
 */

/* ---- Looks ---- */

const W_BASE = `inline-flex shrink-0 items-center justify-center gap-1.5 border-black/80 font-display font-semibold whitespace-nowrap shadow-[0_3px_0_rgb(0_0_0/0.55)] transition-[background-color,color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_rgb(0_0_0/0.55)] motion-reduce:transition-none ${FOCUS}`;
/** Small buttons on the walnut panel (36px): sun for the main action, walnut keys else. */
const W_BTN = {
  primary: `${W_BASE} h-9 rounded-[12px] border-2 bg-sun px-3 text-[13px] text-walnut hover:bg-[#f6d98f]`,
  secondary: `${W_BASE} h-9 rounded-[12px] border-2 bg-walnut-key px-3 text-[13px] text-walnut-text hover:bg-[#4a423b]`,
} as const;
/** The walnut panel itself, as the timer card draws it. */
const W_CARD =
  "pointer-events-auto rounded-[22px] border-[3px] border-black/80 bg-walnut/95 text-walnut-text shadow-[0_6px_0_rgb(0_0_0/0.55)]";
const W_DIVIDE = "border-dashed border-walnut-text/20";
const ENTER =
  "transition duration-200 ease-out starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none";
const KEY_LIGHT = "kbd !h-5 !min-w-5 !px-1 !text-[0.68rem]";
const STAMP =
  "absolute -top-5 -right-4 grid h-14 w-14 rotate-12 place-items-center rounded-full border-[3px] border-walnut text-walnut shadow-[0_4px_0_#1f1a16]";
/** A big choice on the claim card: icon sticker, name, one line saying what it means. */
const CHOICE = `group flex w-full items-center gap-3.5 rounded-[18px] border-[3px] border-walnut bg-surface p-3.5 text-left shadow-[0_4px_0_#1f1a16] transition-[background-color,transform,box-shadow] duration-150 ease-out outline-none hover:-translate-y-px hover:bg-[#fff6dc] focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-offset-2 active:translate-y-[3px] active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-dashed disabled:border-walnut/45 disabled:bg-surface disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0`;
const CHOICE_DOT =
  "grid h-11 w-11 shrink-0 -rotate-6 place-items-center rounded-full border-[3px] border-walnut text-walnut shadow-[0_3px_0_#1f1a16]";

/** A padlock in the icon set's style (2px walnut line on a 24px grid). */
function IconLock({ size = 20, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <rect x="5.25" y="10.75" width="13.5" height="9" rx="2" />
      <path d="M8.5 10.75V8a3.5 3.5 0 017 0v2.75M12 14.5v1.75" />
    </svg>
  );
}

/** An envelope in the same style, for email invites. */
function IconMail({ size = 20, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2" />
      <path d="M4.5 7l7.5 6 7.5-6" />
    </svg>
  );
}

/** "A and B", "A, B, and C". */
function listText(parts: string[]) {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** "Hold Shift to use the buttons", while the mouse is captured for looking around. */
function ShiftHint() {
  const locked = useGameStore((s) => s.pointerLocked);
  if (!locked) return null;
  return (
    <p className="mt-4 flex items-center justify-center gap-1.5 font-display text-xs font-medium text-ink-soft">
      Hold <kbd className={KEY_LIGHT}>Shift</kbd> to use the buttons
    </p>
  );
}

/** Captures the mouse again for looking around (from a click), unless Shift is holding it free. */
function recapture() {
  if (!useGameStore.getState().cursorFree) requestPointerLock({ quiet: true });
}

/** The current time, refreshed every `ms`. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Time left on a hold by the server's clock. */
function useLeft(hold: TableStatus | null) {
  const now = useNow();
  const offset = useTables((s) => s.offsetMs);
  return msLeft(hold?.endsAt, now + offset);
}

/** Why "private" can't be picked right now (null: it can). */
function usePrivateBlock() {
  const view = useTables((s) => s.view);
  if (!view) return "Checking sign-in…";
  if (!view.privateAvailable) return "Sign-in isn't set up";
  if (!view.signedIn) return "Sign in to make a private table";
  return null;
}

/* ---- The layer ---- */

/**
 * Everything about holding tables on screen, mounted over the library beside the timer's layer.
 * It also keeps the tables' status fresh (the 3D signs read the same store).
 */
export function TableHoldLayer() {
  useTablesLive();
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  const seatTable = useGameStore((s) => getSeat(s.seatId)?.tableId ?? null);
  const locked = useGameStore((s) => s.pointerLocked);
  const offer = useTables((s) => s.offer);
  const setup = useTables((s) => s.setup);
  const blocked = useTables((s) => s.blocked);
  const timeUp = useTables((s) => s.timeUp);
  const leaving = useTables((s) => s.leaving);
  const mine = useTables((s) => s.view?.mine ?? null);
  const left = useLeft(mine);
  const holding = !!mine && left > 0;
  const [optionsOpen, setOptionsOpen] = useState(false);

  // The offer and "who can join" belong to the table you're sitting at: standing up puts them away.
  useEffect(() => {
    const t = useTables.getState();
    if ((t.offer && t.offer !== seatTable) || (t.setup && t.setup !== seatTable)) dismissOffer();
  }, [seatTable]);

  // Clicking back into the view to look around puts the choices away (like the timer's settings).
  const [wasLocked, setWasLocked] = useState(locked);
  if (locked !== wasLocked) {
    setWasLocked(locked);
    if (locked) setOptionsOpen(false);
  }
  useEffect(() => {
    if (locked && useTables.getState().setup) useTables.setState({ setup: null });
  }, [locked]);
  if (optionsOpen && !holding) setOptionsOpen(false);

  const shown = ready && playing;
  const setupShown = shown && !!setup && setup === seatTable && holding && mine?.tableId === setup;
  const offerShown = shown && !!offer && offer === seatTable && !setupShown;
  const panelOpen = setupShown || (shown && optionsOpen);

  // Choosing who can join takes a few clicks: keep the mouse free (and the game still) meanwhile.
  useEffect(() => {
    if (!panelOpen) return;
    setTimerPanelOpen("table", true);
    return () => setTimerPanelOpen("table", false);
  }, [panelOpen]);

  // Esc closes the top card while the mouse is free (marked handled before the pause menu hears
  // it). With the mouse captured, Esc is the browser's and the menu's, as everywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || e.defaultPrevented) return;
      const g = useGameStore.getState();
      if (
        g.pointerLocked ||
        g.phase !== "playing" ||
        g.menuOpen ||
        g.guideOpen ||
        g.progressOpen ||
        g.librarianOpen ||
        isBoardOpen() ||
        isLessonOverlayOpen()
      )
        return;
      const t = useTables.getState();
      if (t.setup) useTables.setState({ setup: null });
      else if (t.offer) dismissOffer();
      else if (t.blocked) dismissReserved();
      else if (optionsOpen) setOptionsOpen(false);
      else if (t.timeUp) dismissTimeUp();
      else {
        const invitation = pendingInvitation(t.view, t.invitesSeen);
        const seat = getSeat(g.seatId)?.tableId ?? null;
        if (!invitation || invitation.tableId === seat) return;
        dismissInvitation(invitationKey(invitation));
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [optionsOpen]);

  if (!shown) return null;
  return (
    <>
      {(offerShown || setupShown || blocked) && (
        <div className="pointer-events-none absolute inset-0 z-[16] grid place-items-center p-4">
          {setupShown && mine ? (
            <SetupCard key={holdKey(mine)} hold={mine} />
          ) : offerShown && offer ? (
            <ClaimCard key={offer} tableId={offer} />
          ) : blocked ? (
            <ReservedCard key={blocked.at} />
          ) : null}
        </div>
      )}
      {leaving && playing && <LeaveTableDialog key={leaving.tableId} tableId={leaving.tableId} />}
      {/* Top right, under the menu button: the timer card has the top left. */}
      <div className="pointer-events-none absolute top-[4.5rem] right-4 z-[11] flex w-[20rem] max-w-[calc(100%-2rem)] flex-col items-stretch gap-2">
        {holding && mine && !setupShown && (
          <HolderPanel
            hold={mine}
            left={left}
            optionsOpen={optionsOpen}
            onOptions={setOptionsOpen}
          />
        )}
        {timeUp && <TimeUpCard key={timeUp.at} tableId={timeUp.tableId} />}
        {!timeUp && <InvitationNotice seatTable={seatTable} />}
        <Toast />
      </div>
    </>
  );
}

/* ---- The claim card ---- */

function ClaimCard({ tableId }: { tableId: string }) {
  const busy = useTables((s) => s.busy);
  const error = useTables((s) => s.error);
  const signedIn = useTables((s) => s.view?.signedIn ?? false);
  const privateAvailable = useTables((s) => s.view?.privateAvailable ?? false);
  const block = usePrivateBlock();
  const noteId = useId();
  const loaded = useTables((s) => s.view !== null);
  useEffect(() => {
    if (!loaded) void refreshTables();
  }, [loaded]);

  const claim = async (visibility: "public" | "private") => {
    const status = await claimTable(tableId, visibility);
    if (status && visibility === "public") recapture();
  };
  const notNow = () => {
    dismissOffer();
    recapture();
  };

  return (
    <section
      aria-labelledby="table-claim-title"
      className={`${PANEL} title-pop pointer-events-auto relative w-[27rem] max-w-full p-6 pt-8 text-walnut`}
    >
      <p className={`${RIBBON} absolute -top-4 left-6`}>{tableName(tableId)}</p>
      <span aria-hidden className={`${STAMP} bg-sun`}>
        <IconClock size={26} strokeWidth={2.5} />
      </span>
      <h2
        id="table-claim-title"
        className="pr-8 font-display text-[26px] leading-tight font-bold text-walnut"
      >
        You&apos;re the first here
      </h2>
      <p className={`mt-1.5 ${BODY}`}>
        Hold this table for {HOLD_TEXT}? Your first name goes on a little card on the table, and you
        can give it up whenever you like.
      </p>

      <div className="mt-5 space-y-3">
        <button
          type="button"
          onClick={() => void claim("public")}
          disabled={!!busy}
          className={CHOICE}
        >
          <span aria-hidden className={`${CHOICE_DOT} bg-leaf`}>
            <IconUsers size={22} strokeWidth={2.25} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[17px] leading-6 font-semibold">
              {busy === "claim" ? "Holding it…" : "Open to everyone"}
            </span>
            <span className="block text-[13.5px] leading-5 font-medium text-ink-soft">
              Anyone can sit down and study here.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void claim("private")}
          disabled={!!busy || !!block}
          aria-describedby={block ? noteId : undefined}
          className={CHOICE}
        >
          <span
            aria-hidden
            className={`${CHOICE_DOT} ${block ? "bg-surface-muted text-ink-soft shadow-none" : "bg-tangerine"}`}
          >
            <IconLock size={22} strokeWidth={2.25} />
          </span>
          <span className="min-w-0">
            <span
              className={`block font-display text-[17px] leading-6 font-semibold ${block ? "text-ink-soft" : ""}`}
            >
              Private
            </span>
            <span className="block text-[13.5px] leading-5 font-medium text-ink-soft">
              {block ? <span id={noteId}>{block}</span> : "Only people you invite can sit here."}
            </span>
          </span>
        </button>
      </div>
      {privateAvailable && !signedIn && (
        <p className="mt-3 text-[13px] leading-5 font-medium text-ink-soft">
          Private tables are tied to your account, so the library knows who&apos;s invited.{" "}
          <a href={loginHref("/")} className={`font-semibold text-walnut underline ${FOCUS}`}>
            Sign in
          </a>{" "}
          (this leaves the library for a moment).
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13.5px] leading-5 font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={notNow} className={BTN.quiet}>
          Not now
        </button>
      </div>
      <ShiftHint />
    </section>
  );
}

/* ---- Who can join (after making it private, and in the holder's panel) ---- */

type Tone = "light" | "walnut";

function WhoCanJoin({ hold, tone }: { hold: TableStatus; tone: Tone }) {
  return (
    <div className="space-y-4">
      <InviteLink hold={hold} tone={tone} />
      <EmailInvites hold={hold} tone={tone} />
      <CirclePicker hold={hold} tone={tone} />
    </div>
  );
}

/** A loose check before asking the server (which checks properly): something@something.tld. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Invite by email": the address someone signed up with. The server keeps only a hash of it and
 * shows the list back masked ("bi•••@gmail.com"); the invite ends with this hold.
 */
function EmailInvites({ hold, tone }: { hold: TableStatus; tone: Tone }) {
  const busy = useTables((s) => s.busy);
  const list = hold.emailInvites ?? [];
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const noteId = useId();
  useEffect(() => {
    if (added === null) return;
    const t = setTimeout(() => setAdded(null), 4000);
    return () => clearTimeout(t);
  }, [added]);

  const light = tone === "light";
  const muted = light ? "text-ink-soft" : HUD_MUTED;
  const full = list.length >= EMAIL_INVITES_PER_HOLD;

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const typed = email.trim();
    if (!typed || busy) return;
    if (typed.length > 254 || !LOOKS_LIKE_EMAIL.test(typed)) {
      setNote("That doesn't look like an email address. Check it and try again.");
      return;
    }
    setNote(null);
    clearTableError();
    const invite = await inviteByEmail(hold.tableId, typed);
    if (invite) {
      setEmail("");
      setAdded(invite.masked);
    }
  };

  const chip = light
    ? "border-walnut/30 bg-surface text-walnut"
    : "border-walnut-text/25 bg-walnut-key text-walnut-text";
  return (
    <div>
      <label
        htmlFor={inputId}
        className={`block font-display text-[14px] leading-5 font-semibold ${light ? "text-walnut" : ""}`}
      >
        Invite by email
      </label>
      <p id={helpId} className={`mt-0.5 text-[13px] leading-5 font-medium ${muted}`}>
        They&apos;ll see it when they sign in with that email. Only verified emails count.
      </p>
      <form onSubmit={(e) => void add(e)} className="mt-2 flex items-center gap-2" noValidate>
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="name@example.com"
          value={email}
          disabled={full}
          aria-describedby={note ? `${helpId} ${noteId}` : helpId}
          aria-invalid={note ? true : undefined}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
            if (note) setNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
          className={
            light
              ? "h-10 min-w-0 flex-1 rounded-[12px] border-2 border-walnut bg-white px-3 text-[13.5px] font-semibold text-walnut outline-none placeholder:font-medium placeholder:text-ink-soft focus-visible:ring-4 focus-visible:ring-sun disabled:opacity-55"
              : "h-9 min-w-0 flex-1 rounded-[12px] border-2 border-black/70 bg-walnut-key px-3 text-[12.5px] font-semibold text-walnut-text outline-none placeholder:font-medium placeholder:text-walnut-text/45 focus-visible:ring-4 focus-visible:ring-sun disabled:opacity-45"
          }
        />
        <button
          type="submit"
          disabled={!!busy || full || !email.trim()}
          className={light ? `${BTN.secondary} !h-10 !px-4 !text-[14px]` : W_BTN.primary}
        >
          <IconPlus size={15} strokeWidth={2.5} />
          {busy === "email" ? "Adding…" : "Add"}
        </button>
      </form>
      {note && (
        <p
          id={noteId}
          role="alert"
          className={`mt-1.5 text-[12.5px] leading-4 font-semibold ${light ? "text-danger" : "text-[#f0b3a6]"}`}
        >
          {note}
        </p>
      )}
      <p
        role="status"
        className={`text-[12.5px] leading-4 font-semibold ${muted} ${added ? "mt-1.5" : ""}`}
      >
        {added ? `Invited ${added}.` : ""}
      </p>
      {list.length > 0 && (
        <ul
          aria-label="Invited by email"
          className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto p-0.5"
        >
          {list.map((invite) => (
            <li
              key={invite.id}
              className={`inline-flex h-8 max-w-full items-center gap-1 rounded-full border-2 pr-1 pl-3 font-display text-[12.5px] font-semibold ${chip}`}
            >
              <span className="truncate">{invite.masked}</span>
              <button
                type="button"
                aria-label={`Remove the invite for ${invite.masked}`}
                title="Remove"
                disabled={!!busy}
                onClick={() => void removeEmailInvite(hold.tableId, invite.id)}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none ${light ? "hover:bg-walnut/10" : "hover:bg-white/10"} ${FOCUS}`}
              >
                <IconClose size={13} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full && (
        <p className={`mt-1.5 text-[12.5px] leading-4 font-medium ${muted}`}>
          That&apos;s {EMAIL_INVITES_PER_HOLD}, the most one table can have. Remove one to add
          someone else.
        </p>
      )}
    </div>
  );
}

function InviteLink({ hold, tone }: { hold: TableStatus; tone: Tone }) {
  const busy = useTables((s) => s.busy);
  const invite = useTables((s) => (s.invite?.key === holdKey(hold) ? s.invite.link : null));
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (copiedAt === null) return;
    const t = setTimeout(() => setCopiedAt(null), 2500);
    return () => clearTimeout(t);
  }, [copiedAt]);

  const copy = async () => {
    const link = invite ?? (await makeInvite(hold.tableId));
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyFailed(false);
      setCopiedAt(Date.now());
    } catch {
      // No clipboard here: the link shows below to copy by hand.
      setCopyFailed(true);
    }
  };

  const light = tone === "light";
  const label =
    busy === "invite" ? "Making a link…" : copiedAt !== null ? "Copied" : "Copy invite link";
  return (
    <div>
      <p
        className={`font-display text-[14px] leading-5 font-semibold ${light ? "text-walnut" : ""}`}
      >
        Invite link
      </p>
      <p
        className={`mt-0.5 text-[13px] leading-5 font-medium ${light ? "text-ink-soft" : HUD_MUTED}`}
      >
        Anyone signed in with the link can sit here until {clockTime(hold.endsAt)}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!!busy}
          className={light ? `${BTN.secondary} !h-10 !px-4 !text-[14px]` : `${W_BTN.primary}`}
        >
          {copiedAt !== null ? (
            <IconCheck size={16} strokeWidth={2.5} />
          ) : (
            <IconCopy size={16} strokeWidth={2.25} />
          )}
          <span aria-live="polite">{label}</span>
        </button>
      </div>
      {invite && (copyFailed || light) && (
        <input
          readOnly
          value={invite}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
          className={
            light
              ? "mt-2 h-10 w-full rounded-[12px] border-2 border-walnut bg-white px-3 text-[13px] font-semibold text-walnut outline-none focus-visible:ring-4 focus-visible:ring-sun"
              : "mt-2 h-9 w-full rounded-[12px] border-2 border-black/70 bg-walnut-key px-3 text-[12.5px] font-semibold text-walnut-text outline-none focus-visible:ring-4 focus-visible:ring-sun"
          }
        />
      )}
    </div>
  );
}

function CirclePicker({ hold, tone }: { hold: TableStatus; tone: Tone }) {
  const circles = useTables((s) => s.circles);
  const chosen = useTables((s) => s.circle);
  const busy = useTables((s) => s.busy);
  useEffect(() => loadCircles(), []);
  const light = tone === "light";
  const key = holdKey(hold);
  const list = circles.status === "ready" ? circles.circles : [];
  const selected =
    chosen?.key === key
      ? chosen.id
      : hold.circleName
        ? (list.find((c) => c.name === hold.circleName)?.id ?? null)
        : null;

  const chip = (on: boolean) =>
    light
      ? `inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border-2 px-3.5 font-display text-[13.5px] font-semibold transition-[background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none ${FOCUS} ${on ? "border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]" : "border-walnut/30 bg-surface text-walnut hover:border-walnut"}`
      : `inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border-2 px-3 font-display text-[12.5px] font-semibold transition-[background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none ${FOCUS} ${on ? "border-black/80 bg-sun text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]" : "border-walnut-text/25 bg-walnut-key text-walnut-text hover:border-walnut-text/60"}`;
  const muted = light ? "text-ink-soft" : HUD_MUTED;

  return (
    <div>
      <p
        id={`circle-${key}`}
        className={`font-display text-[14px] leading-5 font-semibold ${light ? "text-walnut" : ""}`}
      >
        Study Circle
      </p>
      <p className={`mt-0.5 text-[13px] leading-5 font-medium ${muted}`}>
        Let the members of one of your circles sit here too.
      </p>
      {circles.status === "loading" || circles.status === "idle" ? (
        <p role="status" className={`mt-2 text-[13px] font-semibold ${muted}`}>
          Loading your circles…
        </p>
      ) : circles.status === "error" ? (
        <p className={`mt-2 flex items-center gap-2 text-[13px] font-semibold ${muted}`}>
          Couldn&apos;t load your circles.
          <button
            type="button"
            onClick={() => loadCircles(true)}
            className={`underline ${light ? "text-walnut" : "text-walnut-text"} ${FOCUS}`}
          >
            Try again
          </button>
        </p>
      ) : list.length === 0 ? (
        <p className={`mt-2 text-[13px] leading-5 font-medium ${muted}`}>
          You&apos;re not in any Study Circles yet. Start one from the menu&apos;s Study circles
          page.
        </p>
      ) : (
        <div
          role="group"
          aria-labelledby={`circle-${key}`}
          className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto p-0.5"
        >
          <button
            type="button"
            aria-pressed={selected === null}
            disabled={!!busy}
            onClick={() => selected !== null && void setCircle(hold.tableId, null)}
            className={chip(selected === null)}
          >
            No circle
          </button>
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={selected === c.id}
              disabled={!!busy}
              onClick={() => selected !== c.id && void setCircle(hold.tableId, c.id)}
              title={`Let members of ${c.name} sit here`}
              className={chip(selected === c.id)}
            >
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Straight after making a table private: who can join. */
function SetupCard({ hold }: { hold: TableStatus }) {
  const error = useTables((s) => s.error);
  const done = () => {
    useTables.setState({ setup: null, error: null });
    recapture();
  };
  return (
    <section
      aria-labelledby="table-setup-title"
      className={`${PANEL} title-pop pointer-events-auto relative max-h-[calc(100dvh-2rem)] w-[27rem] max-w-full overflow-y-auto p-6 pt-8 text-walnut`}
    >
      <p className={`${RIBBON} absolute -top-4 left-6`}>{tableName(hold.tableId)} · Private</p>
      <span aria-hidden className={`${STAMP} bg-leaf`}>
        <IconCheck size={26} strokeWidth={2.75} />
      </span>
      <h2
        id="table-setup-title"
        className="pr-8 font-display text-[26px] leading-tight font-bold text-walnut"
      >
        It&apos;s yours until {clockTime(hold.endsAt)}
      </h2>
      <p className={`mt-1.5 ${BODY}`}>
        Only you can sit here for now. Choose who can join you; you can change it any time from your
        table&apos;s panel.
      </p>
      <div className="mt-5 rounded-[18px] border-2 border-walnut/25 bg-canvas p-4">
        <WhoCanJoin hold={hold} tone="light" />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13.5px] leading-5 font-semibold text-danger">
          {error}
        </p>
      )}
      <button type="button" onClick={done} className={`${BTN.primary} mt-5 w-full`}>
        Done
      </button>
      <ShiftHint />
    </section>
  );
}

/* ---- The holder's panel ---- */

function HolderPanel({
  hold,
  left,
  optionsOpen,
  onOptions,
}: {
  hold: TableStatus;
  left: number;
  optionsOpen: boolean;
  onOptions: (open: boolean) => void;
}) {
  const busy = useTables((s) => s.busy);
  const error = useTables((s) => s.error);
  const block = usePrivateBlock();
  const [confirming, setConfirming] = useState(false);
  const blockId = useId();
  const isPrivate = hold.visibility === "private";
  const soon = left <= WARN_MINUTES * 60_000;
  const emailCount = hold.emailInvites?.length ?? 0;

  const pick = (visibility: "public" | "private") => {
    if (visibility === hold.visibility) return;
    clearTableError();
    void setVisibility(hold.tableId, visibility);
  };
  const giveUp = async () => {
    const ok = await releaseTable(hold.tableId);
    if (ok) setConfirming(false);
  };

  const segment = (on: boolean) =>
    `h-8 rounded-[10px] border-2 px-3 font-display text-[13px] font-semibold transition-[background-color,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none ${FOCUS} ${on ? "border-black/80 bg-sun text-walnut" : "border-transparent text-walnut-text hover:border-walnut-text/30"}`;

  return (
    <section aria-label="Your table" className={`${W_CARD} ${ENTER} w-full px-4 pt-3.5 pb-3.5`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`grid h-9 w-9 shrink-0 -rotate-6 place-items-center rounded-full border-2 border-black/80 text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)] ${isPrivate ? "bg-tangerine" : "bg-leaf"}`}
        >
          {isPrivate ? (
            <IconLock size={18} strokeWidth={2.4} />
          ) : (
            <IconUsers size={18} strokeWidth={2.4} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-display text-xs leading-4 font-semibold ${HUD_MUTED}`}>
            Your table · {isPrivate ? "Private" : "Open"}
          </p>
          <p className="mt-0.5 truncate font-display text-[15px] leading-5 font-semibold">
            {tableName(hold.tableId)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            role="timer"
            aria-label={`Time left at ${tableName(hold.tableId)}`}
            className={`tabular font-display text-[28px] leading-none font-bold tracking-[-0.01em] [text-shadow:0_3px_0_rgb(0_0_0/0.55)] ${soon ? "text-tangerine" : "text-sun"}`}
          >
            {formatClock(left)}
          </p>
          <p className={`mt-1 text-[11px] leading-3 font-semibold ${HUD_MUTED}`}>
            until {clockTime(hold.endsAt)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div
          role="group"
          aria-label="Who can sit here"
          className="inline-flex gap-0.5 rounded-[13px] border-2 border-black/70 bg-walnut-key p-0.5"
        >
          <button
            type="button"
            aria-pressed={!isPrivate}
            disabled={!!busy}
            onClick={() => pick("public")}
            className={segment(!isPrivate)}
          >
            Open
          </button>
          <button
            type="button"
            aria-pressed={isPrivate}
            disabled={!!busy || (!isPrivate && !!block)}
            aria-describedby={!isPrivate && block ? blockId : undefined}
            title={!isPrivate && block ? block : undefined}
            onClick={() => pick("private")}
            className={segment(isPrivate)}
          >
            Private
          </button>
        </div>
        {isPrivate && (
          <button
            type="button"
            aria-expanded={optionsOpen}
            onClick={() => onOptions(!optionsOpen)}
            className={`${W_BTN.secondary} ml-auto`}
          >
            <IconUsers size={15} strokeWidth={2.25} />
            {optionsOpen ? "Done" : "Who can join"}
          </button>
        )}
      </div>
      {!isPrivate && block && (
        <p id={blockId} className={`mt-1.5 text-[11.5px] leading-4 font-medium ${HUD_MUTED}`}>
          {block}
        </p>
      )}

      {isPrivate &&
        (optionsOpen ? (
          <div className={`mt-3 border-t-2 pt-3 ${W_DIVIDE}`}>
            <WhoCanJoin hold={hold} tone="walnut" />
          </div>
        ) : (
          <p className={`mt-2 text-[12px] leading-4 font-medium ${HUD_MUTED}`}>
            {listText([
              "You",
              "people with your invite link",
              ...(emailCount
                ? [
                    `${emailCount === 1 ? "the person" : `the ${emailCount} people`} you invited by email`,
                  ]
                : []),
              ...(hold.circleName ? [`members of ${hold.circleName}`] : []),
            ])}{" "}
            can sit here.
          </p>
        ))}

      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-4 font-semibold text-[#f0b3a6]">
          {error}
        </p>
      )}

      <div className={`mt-3 flex items-center gap-2 border-t-2 pt-3 ${W_DIVIDE}`}>
        {confirming ? (
          <>
            <p className="min-w-0 flex-1 text-[12.5px] leading-4 font-semibold">
              Give up {tableName(hold.tableId)}?
            </p>
            <button type="button" onClick={() => setConfirming(false)} className={W_BTN.secondary}>
              Keep it
            </button>
            <button
              type="button"
              onClick={() => void giveUp()}
              disabled={!!busy}
              className={W_BTN.primary}
            >
              {busy === "release" ? "Giving up…" : "Give it up"}
            </button>
          </>
        ) : (
          <>
            <p className={`min-w-0 flex-1 text-[11.5px] leading-4 font-medium ${HUD_MUTED}`}>
              It opens to everyone when the time&apos;s up.
            </p>
            <button type="button" onClick={() => setConfirming(true)} className={W_BTN.secondary}>
              Give up table
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ---- Notices ---- */

/** Your hold ran out. A quiet card at the side: you stay seated, and a pomodoro carries on. */
function TimeUpCard({ tableId }: { tableId: string }) {
  const seatedHere = useGameStore((s) => getSeat(s.seatId)?.tableId === tableId);
  return (
    <section
      role="status"
      aria-labelledby="table-timeup-title"
      className={`${PANEL} ${ENTER} pointer-events-auto relative mt-3 w-full p-5 pt-6 text-walnut`}
    >
      <p className={`${RIBBON} absolute -top-3.5 left-5`}>Time&apos;s up</p>
      <h2 id="table-timeup-title" className="font-display text-[19px] leading-6 font-bold">
        Your {HOLD_NOUN} at {tableName(tableId)} is up
      </h2>
      <p className="mt-1 text-[14px] leading-5 font-medium text-ink-soft">
        The table is open again.
        {seatedHere ? " You can stay in your seat; anyone can sit here now." : ""}
      </p>
      <button
        type="button"
        onClick={dismissTimeUp}
        className={`${BTN.secondary} mt-4 !h-10 w-full`}
      >
        Got it
      </button>
    </section>
  );
}

/**
 * "Give up Table 6?": leaving the table you hold gives it back to the library, so they're asked
 * first. Staying keeps them seated; giving it up frees the table, then gets them up.
 */
function LeaveTableDialog({ tableId }: { tableId: string }) {
  const mine = useTables((s) => s.view?.mine ?? null);
  const busy = useTables((s) => s.busy === "release");
  const left = useLeft(mine?.tableId === tableId ? mine : null);
  const minutes = Math.max(1, Math.ceil(left / 60_000));

  const stay = () => {
    cancelLeave();
    recapture();
  };
  const giveUp = async () => {
    const then = useTables.getState().leaving?.then ?? null;
    // Even if the library can't be reached, they still get up (the hold then just runs out).
    await releaseTable(tableId);
    cancelLeave();
    standUp({ force: true });
    then?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      cancelLeave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="pointer-events-auto absolute inset-0 z-[30] grid place-items-center bg-walnut/50 p-4">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-table-title"
        aria-describedby="leave-table-body"
        className={`${PANEL} ${ENTER} relative w-full max-w-[24rem] p-6 pt-7 text-walnut`}
      >
        <p className={`${RIBBON} absolute -top-3.5 left-5`}>{tableName(tableId)}</p>
        <h2 id="leave-table-title" className="font-display text-[21px] leading-7 font-bold">
          Give up your table?
        </h2>
        <p id="leave-table-body" className={`mt-1.5 ${BODY}`}>
          Leaving your seat gives {tableName(tableId)} back to the library, so anyone can sit here.
          You still have {minutes} min on it.
        </p>
        <div className="mt-5 grid gap-2.5">
          <button type="button" autoFocus onClick={stay} className={`${BTN.primary} w-full`}>
            Stay at my table
          </button>
          <button
            type="button"
            onClick={() => void giveUp()}
            disabled={busy}
            className={`${BTN.danger} w-full`}
          >
            {busy ? "Giving it up…" : "Give it up and leave"}
          </button>
        </div>
      </section>
    </div>
  );
}

/** "Table 3 is reserved": a private table you can't use, and how to get in. */
function ReservedCard() {
  const blocked = useTables((s) => s.blocked);
  // Signed in, but Auth0 hasn't told us of a verified email (unverified, or an older sign-in).
  const noVerifiedEmail = useTables((s) => !!s.view?.signedIn && s.view.emailVerified === false);
  if (!blocked) return null;
  const { status, reason, message } = blocked;
  const name = tableName(status.tableId);
  const who = status.holderName;
  const until = clockTime(status.endsAt);
  const signIn = reason === "sign_in_required";
  return (
    <section
      role="alert"
      aria-labelledby="table-reserved-title"
      className={`${PANEL} title-pop pointer-events-auto relative w-[26rem] max-w-full p-6 pt-8 text-walnut`}
    >
      <p className={`${RIBBON} absolute -top-4 left-6`}>Reserved</p>
      <span aria-hidden className={`${STAMP} bg-tangerine`}>
        <IconLock size={26} strokeWidth={2.5} />
      </span>
      <h2
        id="table-reserved-title"
        className="pr-8 font-display text-[26px] leading-tight font-bold text-walnut"
      >
        {name} is reserved
      </h2>
      <div className={`mt-2.5 ${BODY}`}>
        {who ? (
          <p>
            <strong className="inline-flex rounded-full border-2 border-walnut bg-sun px-2 font-display font-semibold text-walnut">
              Private · {who}
              {until ? ` until ${until}` : ""}
            </strong>
          </p>
        ) : (
          message && <p>{message}</p>
        )}
        <p className="mt-2">
          {signIn
            ? `If ${who ?? "whoever holds it"} invited you, by link or by email, sign in to sit here.`
            : `Ask ${who ?? "whoever holds it"} to invite you, by link or by email. Or find a free table: there are plenty.`}
        </p>
        {!signIn && noVerifiedEmail && (
          <p className="mt-2 text-[14px] leading-5">
            Invited by email?{" "}
            <a href={loginHref("/")} className={`font-semibold text-walnut underline ${FOCUS}`}>
              Sign in again
            </a>{" "}
            or verify your email to use it.
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2.5 [&>*]:flex-1">
        <button type="button" onClick={dismissReserved} className={BTN.primary}>
          OK
        </button>
        {signIn && (
          <a href={loginHref("/")} className={BTN.secondary}>
            Sign in
          </a>
        )}
      </div>
      <ShiftHint />
    </section>
  );
}

/**
 * A private table someone invited your verified email to (the first still running that you
 * haven't put away, and not the table you're sitting at).
 */
function InvitationNotice({ seatTable }: { seatTable: string | null }) {
  const view = useTables((s) => s.view);
  const seen = useTables((s) => s.invitesSeen);
  const offset = useTables((s) => s.offsetMs);
  const now = useNow(5000);
  const invitation = pendingInvitation(view, seen, now + offset);
  if (!invitation || invitation.tableId === seatTable) return null;
  return <InvitationCard key={invitationKey(invitation)} invitation={invitation} />;
}

/** "Suad invited you to Table 3 · private · until 4:20 PM", with "Show me" and "Got it". */
function InvitationCard({ invitation }: { invitation: TableInvitation }) {
  const key = invitationKey(invitation);
  const highlighted = useTables((s) => s.highlighted === key);
  const name = tableName(invitation.tableId);
  const until = clockTime(invitation.endsAt);
  const hintId = useId();
  return (
    <section
      role="status"
      aria-labelledby="table-invited-title"
      className={`${PANEL} ${ENTER} pointer-events-auto relative mt-3 w-full p-5 pt-6 text-walnut`}
    >
      <p className={`${RIBBON} absolute -top-3.5 left-5`}>Invited</p>
      <span
        aria-hidden
        className="absolute -top-4 -right-3 grid h-11 w-11 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]"
      >
        <IconMail size={20} strokeWidth={2.4} />
      </span>
      <h2 id="table-invited-title" className="pr-6 font-display text-[18px] leading-6 font-bold">
        {invitation.holderName} invited you to{" "}
        <mark
          className={`rounded-[8px] text-walnut transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none ${highlighted ? "bg-sun px-1 shadow-[0_0_0_2px_#1f1a16]" : "bg-transparent"}`}
        >
          {name}
        </mark>
        <span className="font-semibold text-ink-soft">
          {" "}
          · private{until ? ` · until ${until}` : ""}
        </span>
      </h2>
      {highlighted && (
        <p id={hintId} className="mt-1.5 text-[14px] leading-5 font-medium text-ink-soft">
          Look for the little card with {invitation.holderName}&apos;s name on {name}. Sit down
          there whenever you like.
        </p>
      )}
      <div className="mt-4 flex gap-2 [&>*]:flex-1">
        <button
          type="button"
          aria-pressed={highlighted}
          aria-describedby={highlighted ? hintId : undefined}
          onClick={() => highlightInvitation(key)}
          className={`${BTN.primary} !h-10 !px-3`}
        >
          Show me
        </button>
        <button
          type="button"
          onClick={() => dismissInvitation(key)}
          className={`${BTN.secondary} !h-10 !px-3`}
        >
          Got it
        </button>
      </div>
    </section>
  );
}

/** A word in passing (the 5-minute warning, "it's yours"), in the HUD's walnut. */
function Toast() {
  const toast = useTables((s) => s.toast);
  return (
    <div role="status" className="flex flex-col items-end">
      {toast && (
        <p
          key={toast.id}
          className={`${HUD_CHIP} ${ENTER} max-w-full px-4 py-2.5 text-[13px] leading-5 font-medium`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}
