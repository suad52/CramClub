"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { CHAT } from "@ovr/shared";
import { IconClose, IconSend } from "@/components/ui/icons";
import { HUD_BTN, HUD_CHIP, HUD_MUTED } from "@/components/ui/styles";
import { type ChatItem, charsLeft, chatItems, typingLabel } from "@/lib/chat/format";
import { CHAT_INPUT_ATTR, installChatEscape, leaveChatInput, mayOpenChat } from "@/lib/chat/keys";
import { focusChat, setChatOpen, setDraft, setFenwickAnswers, useChat } from "@/lib/chat/store";
import { exitPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";
import {
  type NetStatus,
  noteChatTyping,
  sendChat,
  sendFenwickPref,
  stopChatTyping,
  useNet,
} from "@/lib/net/connection";
import { useRemotePlayers } from "@/lib/net/players";

/*
 * The library chat, bottom left of the HUD (components/library/Hud.tsx places it): a small
 * "Chat" pill with how many lines came in since you last looked, which opens into a compact
 * panel. Enter opens it with the cursor in the box (when no menu, panel or dialog is over the
 * library and the Enter wasn't someone else's, a lesson's quick check say), Enter sends, Enter on
 * an empty box goes back to walking, Esc closes it. While the cursor is in the box the mouse is
 * free and the game's keys are text (lib/chat/keys.ts). Everyone's first name shows; your lines
 * are sun yellow, Ms. Fenwick's are her cream sticker (her shush caption's look, components/focus/
 * FocusBits.tsx), with whom she's answering. The switch under the box ("Ms. Fenwick answers if
 * nobody does") is remembered in this browser, sent with each line, and sent to the room when
 * flipped (off cancels her wait on your last line). Without the live library (solo, connecting,
 * full) the panel says chat needs it and the box is off. The list gets shorter so the open panel
 * ends below the table timer's stack in the top left (useListRoom), which sits above the HUD.
 */

// Esc in the box closes the chat, before the table cards or the timer settings can take it.
installChatEscape(() => {
  leaveChatInput();
  setChatOpen(false);
});

/** A speech bubble, in the icon set's style (components/ui/icons.tsx). */
function IconChat({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <path d="M5.25 5.5h13.5c.83 0 1.5.67 1.5 1.5v8.25c0 .83-.67 1.5-1.5 1.5H11l-4.5 3.25v-3.25H5.25c-.83 0-1.5-.67-1.5-1.5V7c0-.83.67-1.5 1.5-1.5z" />
    </svg>
  );
}

/** Enter in the library opens the chat (after every other handler has had the key). */
function useOpenKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.isComposing) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!mayOpenChat(e.target)) return;
      // A lesson's quick check (or anything else) that takes this Enter marks it handled.
      setTimeout(() => {
        if (!e.defaultPrevented && mayOpenChat(document.activeElement)) focusChat();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function ChatPill() {
  const unread = useChat((s) => s.unread);
  const label = unread > 0 ? `Chat, ${unread} new ${unread === 1 ? "line" : "lines"}` : "Chat";
  return (
    <button
      type="button"
      onClick={() => focusChat()}
      title="Chat with the library (Enter)"
      aria-label={label}
      aria-keyshortcuts="Enter"
      className={`${HUD_BTN} pointer-events-auto relative h-10`}
    >
      <IconChat />
      Chat
      <kbd className="kbd kbd-dark !h-5 !min-w-5 !text-[0.68rem]" aria-hidden>
        Enter
      </kbd>
      {unread > 0 && (
        <span
          aria-hidden
          className="title-pop absolute -top-2.5 -right-2.5 grid h-6 min-w-6 place-items-center rounded-full border-2 border-black/80 bg-tangerine px-1 text-[12px] leading-none font-bold text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const timeOf = (at: number) => (at > 0 ? TIME.format(at) : undefined);

function Line({ item }: { item: ChatItem }) {
  const { line, kind, head, who, to } = item;
  if (kind === "fenwick") {
    return (
      <li className={`flex flex-col items-start ${head ? "mt-1.5" : ""}`}>
        <p
          title={timeOf(line.at)}
          className="max-w-[92%] rounded-[16px] rounded-bl-[6px] border-[3px] border-black/80 bg-surface py-1.5 pr-3.5 pl-3 text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)]"
        >
          {head && (
            <span className="block font-display text-[12px] leading-4 font-semibold text-ink-soft">
              {who}
              {to && <span className="font-medium"> · to {to}</span>}
            </span>
          )}
          <span className="block font-sans text-[14px] leading-5 font-semibold break-words">
            {line.text}
          </span>
        </p>
      </li>
    );
  }
  const mine = kind === "mine";
  return (
    <li className={`flex flex-col ${mine ? "items-end" : "items-start"} ${head ? "mt-1.5" : ""}`}>
      {head && (
        <span className={`px-1 text-[12px] leading-4 font-semibold ${HUD_MUTED}`}>{who}</span>
      )}
      <p
        title={timeOf(line.at)}
        className={`max-w-[85%] rounded-[14px] border-2 px-3 py-1.5 font-sans text-[14px] leading-5 font-semibold break-words ${
          mine
            ? "rounded-br-[6px] border-black/80 bg-sun text-walnut"
            : "rounded-bl-[6px] border-black/50 bg-walnut-key/85 text-walnut-text"
        }`}
      >
        {line.text}
      </p>
    </li>
  );
}

/** Three dots stepping along, for "… is typing". */
function TypingDots() {
  return (
    <span aria-hidden className="inline-flex items-end gap-[3px] pb-[3px]">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-walnut-muted motion-reduce:animate-none"
        />
      ))}
    </span>
  );
}

const OFFLINE_NOTE: Record<Exclude<NetStatus, "online">, string> = {
  offline: "Chat needs the live library, and you're exploring solo right now.",
  connecting: "Joining the live library… chat opens as soon as you're in.",
  full: "The library is full, so chat is off for now. You can keep studying.",
  error: "Can't reach the live library. Chat comes back as soon as it does.",
};

/** The "Ms. Fenwick answers if nobody does" switch. */
function FenwickSwitch() {
  const on = useChat((s) => s.fenwick);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        setFenwickAnswers(!on);
        sendFenwickPref(!on);
      }}
      // Keeps the cursor in the box when you flip it mid-sentence.
      onMouseDown={(e) => e.preventDefault()}
      title={
        on
          ? "If nobody answers you, the librarian replies in the chat."
          : "The librarian stays out of the chat."
      }
      className="inline-flex items-center gap-2 rounded-[8px] text-[12px] leading-4 font-semibold text-walnut-muted outline-none focus-visible:ring-2 focus-visible:ring-sun"
    >
      <span
        aria-hidden
        className={`relative h-[18px] w-8 shrink-0 rounded-full border-2 border-black/80 transition-colors duration-150 motion-reduce:transition-none ${on ? "bg-leaf" : "bg-walnut-key"}`}
      >
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-black/80 bg-surface transition-[left] duration-150 motion-reduce:transition-none ${on ? "left-[14px]" : "left-[1px]"}`}
        />
      </span>
      Ms. Fenwick answers if nobody does
    </button>
  );
}

/** Room left between the open panel and the table timer's stack above it, px. */
const ABOVE_GAP_PX = 12;
/** The list's own limits, px (the class's 5.5rem / 15rem). */
const LIST_MIN_PX = 88;
const LIST_MAX_PX = 240;

/**
 * The tallest the list may be for the panel to end below the table timer's stack (top left,
 * drawn above the HUD; components/library/Pomodoro.tsx marks it `data-hud-top-left`), or null
 * until measured (the class's clamp holds meanwhile). Measured again when that stack changes
 * size (the card, its toasts), moves (the "Walking faster" chip) or comes and goes, and when the
 * window does.
 */
function useListRoom(
  panel: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    let watched: Element | null = null;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    function measure() {
      frame = 0;
      const box = panel.current;
      const ol = list.current;
      if (!box || !ol) return;
      const above = document.querySelector("[data-hud-top-left]");
      if (above !== watched) {
        if (watched) observer.unobserve(watched);
        if (above) observer.observe(above);
        watched = above;
      }
      const top = above ? above.getBoundingClientRect().bottom + ABOVE_GAP_PX : 0;
      const chrome = box.offsetHeight - ol.offsetHeight;
      const space = Math.floor(box.getBoundingClientRect().bottom - top - chrome);
      setRoom(Math.max(LIST_MIN_PX, Math.min(LIST_MAX_PX, space)));
    }
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", schedule);
    const unsubscribe = useGameStore.subscribe((s, prev) => {
      if (s.walkFast !== prev.walkFast || s.ready !== prev.ready || s.phase !== prev.phase)
        schedule();
    });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      unsubscribe();
    };
  }, [panel, list]);
  return room;
}

/** How long "Slow down a little" (and "Not sent") stay up. */
const NOTICE_MS = 2600;
/** The last focus request the panel acted on (outlives the panel: the HUD unmounts it). */
let focusHandled = 0;

function Panel() {
  const status = useNet((s) => s.status);
  const selfId = useNet((s) => s.selfId);
  const count = useNet((s) => s.count);
  const lines = useChat((s) => s.lines);
  const typing = useChat((s) => s.typing);
  const fenwickTyping = useChat((s) => s.fenwickTyping.length > 0);
  const fenwick = useChat((s) => s.fenwick);
  const draft = useChat((s) => s.draft);
  const focusNonce = useChat((s) => s.focusNonce);
  const players = useRemotePlayers((s) => s.players);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const section = useRef<HTMLElement>(null);
  const listRoom = useListRoom(section, list);
  /** The list follows new lines unless you've scrolled up to read. */
  const stick = useRef(true);
  const online = status === "online";

  const items = chatItems(lines, selfId, (id) => players[id]?.name);
  const typingNames = typing.map((id) => players[id]?.name ?? "Someone");
  const typingText = online ? typingLabel(typingNames, fenwickTyping) : null;
  const left = charsLeft(draft);

  // Enter (or the pill) asks for the cursor in the box; offline, the close button takes focus so
  // Esc and Enter still do something. Only on a new request: not when the link comes back, nor
  // when the HUD comes back with the panel still open (from the character studio, say).
  useEffect(() => {
    if (focusNonce === focusHandled) return;
    focusHandled = focusNonce;
    if (useNet.getState().status === "online") input.current?.focus();
    else close.current?.focus();
  }, [focusNonce]);

  // The mouse captured again (a click on the library, Shift let go): back to walking.
  useEffect(
    () =>
      useGameStore.subscribe((s, prev) => {
        if (s.pointerLocked && !prev.pointerLocked) leaveChatInput();
      }),
    [],
  );

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length, typingText]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const submit = () => {
    if (!draft.trim()) {
      // Enter on an empty box: back to walking around (the panel stays open).
      leaveChatInput();
      return;
    }
    const result = sendChat(draft, fenwick);
    if (result === "sent") {
      setDraft("");
      stick.current = true;
    } else if (result === "slow") {
      setNotice({ text: "Slow down a little: one line every couple of seconds.", at: Date.now() });
    } else if (result === "offline") {
      setNotice({ text: "Not sent: the live library isn't connected.", at: Date.now() });
    }
  };

  const people = count <= 1 ? "Just you here" : `${count} here`;
  const empty = fenwick
    ? "It's quiet in here. Say hi! If nobody answers, Ms. Fenwick will."
    : "It's quiet in here. Say hi to whoever's studying!";

  return (
    <section
      ref={section}
      aria-label="Library chat"
      onKeyDown={(e) => {
        // Esc with the focus on the panel's buttons (the box handles its own, lib/chat/keys.ts).
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur();
        setChatOpen(false);
      }}
      className={`${HUD_CHIP} title-pop pointer-events-auto flex w-[21rem] max-w-[calc(100vw-2rem)] flex-col`}
    >
      <header className="flex items-center gap-2 border-b-2 border-black/30 py-2 pr-2 pl-3.5">
        <IconChat size={17} />
        <h2 className="text-[14px] leading-5 font-semibold">Library chat</h2>
        {online && (
          <span className={`text-[12px] leading-4 font-semibold ${HUD_MUTED}`}>· {people}</span>
        )}
        <button
          ref={close}
          type="button"
          onClick={() => {
            leaveChatInput();
            setChatOpen(false);
          }}
          title="Close chat (Esc)"
          aria-label="Close chat"
          aria-keyshortcuts="Escape"
          className="ml-auto grid h-7 w-7 place-items-center rounded-[10px] border-2 border-black/80 bg-surface text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)] transition-transform duration-150 outline-none hover:-translate-y-px focus-visible:ring-4 focus-visible:ring-sun active:translate-y-[2px] active:shadow-none motion-reduce:transition-none"
        >
          <IconClose size={16} strokeWidth={2.5} />
        </button>
      </header>

      <ol
        ref={list}
        role="log"
        aria-live="polite"
        aria-label="Chat lines"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
        }}
        style={listRoom === null ? undefined : { maxHeight: listRoom }}
        className="flex max-h-[clamp(7rem,calc(100dvh-32rem),15rem)] min-h-[5.5rem] flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-2"
      >
        {!online ? (
          <li
            className={`my-auto px-1 py-2 text-center font-sans text-[13px] leading-5 font-semibold ${HUD_MUTED}`}
          >
            {OFFLINE_NOTE[status]}
          </li>
        ) : items.length === 0 ? (
          <li
            className={`my-auto px-1 py-2 text-center font-sans text-[13px] leading-5 font-semibold ${HUD_MUTED}`}
          >
            {empty}
          </li>
        ) : (
          items.map((item) => <Line key={item.line.id} item={item} />)
        )}
      </ol>

      <p
        aria-live="polite"
        className={`flex h-5 items-center gap-1.5 truncate px-3.5 text-[12px] leading-4 font-semibold ${notice ? "text-sun" : HUD_MUTED}`}
      >
        {notice ? (
          notice.text
        ) : typingText ? (
          <>
            <TypingDots />
            <span className="truncate">{typingText}</span>
          </>
        ) : null}
      </p>

      <div className="px-3 pt-1 pb-3">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Message to the library</span>
            <input
              ref={input}
              {...{ [CHAT_INPUT_ATTR]: "" }}
              type="text"
              value={draft}
              disabled={!online}
              maxLength={CHAT.MAX_CHARS}
              autoComplete="off"
              spellCheck
              enterKeyHint="send"
              placeholder={online ? "Say something to the library…" : "Chat needs the live library"}
              onFocus={() => exitPointerLock()}
              onBlur={() => stopChatTyping()}
              onChange={(e) => {
                setDraft(e.target.value);
                noteChatTyping(e.target.value);
              }}
              onKeyDown={(e) => {
                // The box's keys are text, never game keys (W, E, P, Shift, numbers, …).
                e.stopPropagation();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              className={`h-10 w-full rounded-[12px] border-[3px] border-black/80 bg-surface px-3 font-sans text-[14px] font-semibold text-walnut shadow-[inset_0_3px_0_rgb(31_26_22/0.08)] outline-none placeholder:font-medium placeholder:text-ink-soft focus-visible:ring-4 focus-visible:ring-sun disabled:cursor-not-allowed disabled:opacity-60 ${left !== null ? "pr-10" : ""}`}
            />
            {left !== null && online && (
              <span
                aria-live="polite"
                className={`tabular pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-display text-[12px] font-semibold ${left <= 10 ? "text-tangerine" : "text-ink-soft"}`}
              >
                {left}
                <span className="sr-only"> characters left</span>
              </span>
            )}
          </label>
          <button
            type="button"
            disabled={!online || !draft.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={submit}
            aria-label="Send"
            title="Send (Enter)"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-[3px] border-black/80 bg-sun text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)] transition-[transform,box-shadow] duration-150 outline-none hover:-translate-y-px focus-visible:ring-4 focus-visible:ring-sun active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none"
          >
            <IconSend size={18} strokeWidth={2.5} />
          </button>
        </div>
        <div className="mt-2">
          <FenwickSwitch />
        </div>
      </div>
    </section>
  );
}

/** The chat pill, or the open panel. */
export function ChatPanel() {
  const open = useChat((s) => s.open);
  useOpenKey();
  return open ? <Panel /> : <ChatPill />;
}
