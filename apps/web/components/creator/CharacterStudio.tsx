"use client";

import { useProgress } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACCESSORIES,
  AVATAR_PRESETS,
  type AccessoryId,
  type AvatarConfig,
  type DetailId,
  labelOf,
  normalizeAccessories,
  randomAvatar,
  slotOf,
} from "@ovr/shared";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
} from "@/components/ui/icons";
import { BTN, BTN_SM, DIVIDER, FOCUS, PANEL, RIBBON } from "@/components/ui/styles";
import { useFaceHeadSource } from "@/components/avatar/Avatar";
import { type HeadSettings, sameHead, sanitizeHead } from "@/lib/avatar/facePhoto";
import { useProfileStore } from "@/lib/avatar/profile";
import { CATEGORIES, type Category, type FramingId, type Section, thumbUrl } from "./categories";
import { HeadPanel } from "./HeadPanel";
import { VoicePanel } from "./VoicePanel";
import { LibraryCard } from "./LibraryCard";
import {
  StudioCanvas,
  type StudioControls,
  type StudioExpression,
  type StudioPose,
  createStudioControls,
} from "./StudioCanvas";
import {
  Icon,
  Keycap,
  OptionTile,
  PresetCard,
  RANGE,
  RANGE_TRACK_PLAYFUL,
  SectionTitle,
  Slider,
  Swatches,
} from "./ui";

const HISTORY_LIMIT = 60;
const RAIL_WIDTH = 232;

const POSES: { id: StudioPose; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "wave", label: "Wave" },
  { id: "sit", label: "Sit" },
];
const EXPRESSIONS: { id: StudioExpression; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "smile", label: "Smile" },
  { id: "wink", label: "Wink" },
  { id: "surprised", label: "Surprised" },
  { id: "sleepy", label: "Sleepy" },
];
const VIEWS: { id: string; label: string; yaw: number; framing?: FramingId }[] = [
  { id: "front", label: "Front", yaw: 0 },
  { id: "side", label: "Side", yaw: -Math.PI / 2 },
  { id: "back", label: "Back", yaw: Math.PI },
  { id: "face", label: "Face", yaw: 0, framing: "face" },
];

function usePanelWidth() {
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth < 1180 ? 340 : 400);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

/** A line icon drawn like the shared set (24px grid, currentColor), a little chunkier. */
function LineIcon({ size = 18, children }: { size?: number; children: React.ReactNode }) {
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
      focusable="false"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const IconUndo = () => (
  <LineIcon>
    <path d="M9 14.25 4.75 10 9 5.75M4.75 10h9.5a5 5 0 0 1 0 10h-3.5" />
  </LineIcon>
);
const IconRedo = () => (
  <LineIcon>
    <path d="M15 14.25 19.25 10 15 5.75M19.25 10h-9.5a5 5 0 0 0 0 10h3.5" />
  </LineIcon>
);
const IconDice = () => (
  <LineIcon>
    <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="3" />
    <path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" strokeWidth={3} />
  </LineIcon>
);

/** Small buttons in the history toolbar (undo, redo, reset). */
const TOOL_BTN = `inline-flex h-9 items-center gap-1.5 rounded-[11px] border-2 border-transparent px-3 font-display text-[13.5px] font-semibold text-walnut transition-[background-color,border-color,translate] duration-150 ease-out hover:enabled:border-walnut hover:enabled:bg-sun active:enabled:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none ${FOCUS}`;

/** A cream sticker floating over the preview: walnut outline and a hard shadow, no blur. */
const TOOLBAR =
  "pointer-events-auto rounded-[18px] border-[3px] border-walnut bg-surface p-1.5 shadow-[0_4px_0_#1f1a16]";

/** A small pill badge, sun yellow, for the step and the "Surprise me" card. */
const SUN_RIBBON =
  "inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-walnut bg-sun px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]";

function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="pl-1.5 font-display text-[12.5px] font-semibold text-ink-soft">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex gap-1 rounded-[13px] border-2 border-walnut/15 bg-canvas p-1"
      >
        {items.map((it) => {
          const on = value === it.id;
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(it.id)}
              className={`h-8 rounded-[10px] border-2 px-3 font-display text-[13.5px] font-semibold transition-[background-color,border-color,color,translate] duration-150 ease-out active:translate-y-px motion-reduce:transition-none ${FOCUS} ${on ? "border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]" : "border-transparent text-walnut/70 hover:border-walnut/40 hover:bg-surface hover:text-walnut"}`}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The character studio: a live 3D preview on a turntable between a category rail (with the
 * randomizer under it) and an options panel of Blender-rendered tiles, swatches and presets, in
 * the cartoon kit (cream stickers, walnut outlines, sun-yellow choices). Nothing is saved until
 * the player signs their library card.
 */
export function CharacterStudio({
  initialConfig,
  initialName,
  firstTime,
  onCancel,
  onSave,
}: {
  initialConfig: AvatarConfig;
  initialName: string;
  /** No saved character yet: the studio is part of the first-run flow. */
  firstTime: boolean;
  onCancel: () => void;
  onSave: (name: string, config: AvatarConfig) => void;
}) {
  const [draft, setDraft] = useState(initialConfig);
  const [past, setPast] = useState<AvatarConfig[]>([]);
  const [future, setFuture] = useState<AvatarConfig[]>([]);
  const [hover, setHover] = useState<Partial<AvatarConfig> | null>(null);
  const [catIndex, setCatIndex] = useState(firstTime ? 0 : 1);
  const [pose, setPose] = useState<StudioPose>("idle");
  const [expression, setExpression] = useState<StudioExpression>("neutral");
  const [view, setView] = useState<string | null>(null);
  const [style, setStyle] = useState(0.5);
  const [cardOpen, setCardOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  // The head (chibi or real face) is saved beside the avatar config, not in it: the photo stays
  // on this device and out of undo history.
  const [initialHead] = useState<HeadSettings>(() => sanitizeHead(useProfileStore.getState()));
  const [head, setHead] = useState(initialHead);
  const faceHead = useFaceHeadSource(head);
  const controls = useRef<StudioControls>(createStudioControls());
  const sliderStart = useRef<AvatarConfig | null>(null);
  const drag = useRef<{ x: number } | null>(null);
  const panelWidth = usePanelWidth();
  const { active: loading, progress } = useProgress();

  const category = CATEGORIES[catIndex]!;
  const shown = useMemo(() => (hover ? { ...draft, ...hover } : draft), [draft, hover]);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initialConfig) || !sameHead(head, initialHead);

  // Camera framing follows the category (and the Face view).
  useEffect(() => {
    const v = VIEWS.find((x) => x.id === view);
    controls.current.framing = v?.framing ?? category.framing;
  }, [category, view]);

  const notify = useCallback((text: string) => setToast({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const commit = useCallback(
    (next: AvatarConfig, from: AvatarConfig = draft) => {
      if (JSON.stringify(next) === JSON.stringify(from)) return;
      setPast((p) => [...p, from].slice(-HISTORY_LIMIT));
      setFuture([]);
      setDraft(next);
    },
    [draft],
  );
  const patch = (p: Partial<AvatarConfig>) => commit({ ...draft, ...p });

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [draft, ...f]);
    setDraft(past[past.length - 1]!);
    setPast((p) => p.slice(0, -1));
  }, [past, draft]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, draft]);
    setDraft(future[0]!);
    setFuture((f) => f.slice(1));
  }, [future, draft]);

  const randomize = useCallback(() => {
    commit(randomAvatar(style));
    controls.current.targetYaw += Math.PI * 2;
    notify(
      style < 0.34 ? "A new, minimal look" : style > 0.66 ? "A new, playful look" : "A new look",
    );
  }, [commit, style, notify]);

  const goCategory = useCallback((i: number) => {
    setCatIndex((i + CATEGORIES.length) % CATEGORIES.length);
    setView(null);
    setHover(null);
  }, []);

  const leave = useCallback(() => {
    if (dirty && !confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    onCancel();
  }, [dirty, confirmLeave, onCancel]);

  // Keyboard: Q/E categories, ←/→ turn, Ctrl+Z / Ctrl+Shift+Z, R randomize, Esc back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea");
      if (cardOpen) {
        if (e.key === "Escape") setCardOpen(false);
        return;
      }
      if (typing && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "q") goCategory(catIndex - 1);
      else if (k === "e") goCategory(catIndex + 1);
      else if (k === "r" && !e.metaKey && !e.ctrlKey) randomize();
      else if (e.key === "ArrowLeft") controls.current.targetYaw -= Math.PI / 4;
      else if (e.key === "ArrowRight") controls.current.targetYaw += Math.PI / 4;
      else if (e.key === "Escape") leave();
      else if (
        e.key === "Enter" &&
        !typing &&
        (e.target as HTMLElement | null)?.tagName !== "BUTTON"
      )
        setCardOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardOpen, catIndex, goCategory, undo, redo, randomize, leave]);

  const toggleAccessory = (id: AccessoryId) => {
    if (draft.accessories.includes(id)) {
      patch({ accessories: draft.accessories.filter((a) => a !== id) });
      return;
    }
    const clash = draft.accessories.find((a) => slotOf(a) === slotOf(id));
    if (clash) notify(`Swapped ${labelOf(ACCESSORIES, clash)} for ${labelOf(ACCESSORIES, id)}`);
    if (id === "backpack") controls.current.targetYaw = Math.PI;
    patch({ accessories: normalizeAccessories([...draft.accessories, id]) });
  };
  const toggleDetail = (id: DetailId) =>
    patch({
      details: draft.details.includes(id)
        ? draft.details.filter((d) => d !== id)
        : [...draft.details, id],
    });

  const hoverMulti = (field: "accessories" | "details", id: string, on: boolean) => {
    if (!on) return setHover(null);
    if (field === "accessories") {
      const a = id as AccessoryId;
      if (draft.accessories.includes(a)) return setHover(null);
      setHover({ accessories: normalizeAccessories([...draft.accessories, a]) });
    } else {
      const d = id as DetailId;
      if (!draft.details.includes(d)) setHover({ details: [...draft.details, d] });
    }
  };

  const renderSection = (s: Section, i: number) => {
    switch (s.kind) {
      case "voice":
        return <VoicePanel key={i} />;
      case "head":
        return (
          <HeadPanel
            key={i}
            value={head}
            onChange={setHead}
            chibiThumb={thumbUrl("hair", draft.hair)}
          />
        );
      case "presets":
        return (
          <div key={i} className="space-y-2">
            {AVATAR_PRESETS.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                active={JSON.stringify(p.config) === JSON.stringify(draft)}
                onPick={() => {
                  commit(p.config);
                  notify(`${p.label} applied. Change anything you like.`);
                }}
              />
            ))}
          </div>
        );
      case "tiles": {
        const value = draft[s.field] as string;
        return (
          <section key={i}>
            <SectionTitle aside={labelOf(s.options, (shown[s.field] as string) ?? value)}>
              {s.title}
            </SectionTitle>
            <div className="grid grid-cols-3 gap-2.5">
              {s.options.map((o) => (
                <OptionTile
                  key={o.id}
                  option={o}
                  src={thumbUrl(s.thumbs, o.id)}
                  selected={value === o.id}
                  onSelect={() => patch({ [s.field]: o.id } as Partial<AvatarConfig>)}
                  onHover={(on) =>
                    setHover(on ? ({ [s.field]: o.id } as Partial<AvatarConfig>) : null)
                  }
                />
              ))}
            </div>
          </section>
        );
      }
      case "multi": {
        const values = draft[s.field] as readonly string[];
        return (
          <section key={i}>
            <SectionTitle aside={`${values.length} chosen`}>{s.title}</SectionTitle>
            {s.hint && <p className="-mt-1 mb-2.5 text-[13px] leading-5 text-ink-soft">{s.hint}</p>}
            <div className="grid grid-cols-3 gap-2.5">
              {s.options.map((o) => {
                const slot = s.field === "accessories" ? slotOf(o.id as AccessoryId) : undefined;
                return (
                  <OptionTile
                    key={o.id}
                    option={o}
                    src={thumbUrl(s.thumbs, o.id)}
                    selected={values.includes(o.id)}
                    badge={slot}
                    onSelect={() =>
                      s.field === "accessories"
                        ? toggleAccessory(o.id as AccessoryId)
                        : toggleDetail(o.id as DetailId)
                    }
                    onHover={(on) => hoverMulti(s.field, o.id, on)}
                  />
                );
              })}
            </div>
          </section>
        );
      }
      case "swatches":
        return (
          <section key={i}>
            <SectionTitle aside={labelOf(s.options, shown[s.field] as string)}>
              {s.title}
            </SectionTitle>
            <Swatches
              options={s.options}
              value={draft[s.field] as string}
              onSelect={(id) => patch({ [s.field]: id } as Partial<AvatarConfig>)}
              onHover={(id) => setHover(id ? ({ [s.field]: id } as Partial<AvatarConfig>) : null)}
            />
          </section>
        );
      case "slider":
        return (
          <section key={i}>
            <SectionTitle
              aside={`${draft[s.field] > 0 ? "+" : ""}${Math.round(draft[s.field] * 100)}`}
            >
              {s.title}
            </SectionTitle>
            <Slider
              label={s.title}
              value={draft[s.field]}
              left={s.left}
              right={s.right}
              onChange={(v) => {
                sliderStart.current ??= draft;
                setDraft((d) => ({ ...d, [s.field]: v }));
              }}
              onCommit={() => {
                const start = sliderStart.current;
                sliderStart.current = null;
                if (start && JSON.stringify(start) !== JSON.stringify(draft)) {
                  setPast((p) => [...p, start].slice(-HISTORY_LIMIT));
                  setFuture([]);
                }
              }}
            />
          </section>
        );
    }
  };

  const centre = `calc(${RAIL_WIDTH + 24}px + (100% - ${RAIL_WIDTH + 24}px - ${panelWidth + 24}px) / 2)`;
  const prevCategory = CATEGORIES[(catIndex - 1 + CATEGORIES.length) % CATEGORIES.length]!;
  const nextCategory = CATEGORIES[(catIndex + 1) % CATEGORIES.length]!;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-canvas bg-[radial-gradient(rgb(31_26_22/0.07)_1.5px,transparent_1.6px)] bg-[length:22px_22px] text-walnut select-none studio-fade-in">
      {/* A flat sun disc behind the character (decorative; the canvas is transparent) */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[46%] aspect-square h-[min(72vh,640px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun/40"
        style={{ left: centre }}
      >
        <span className="absolute inset-5 rounded-full border-[3px] border-dashed border-walnut/10" />
      </div>

      {/* 3D preview + turntable drag surface */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX };
          controls.current.dragging = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          controls.current.targetYaw += (e.clientX - drag.current.x) * 0.012;
          drag.current.x = e.clientX;
        }}
        onPointerUp={() => {
          drag.current = null;
          controls.current.dragging = false;
        }}
        onWheel={(e) => {
          const c = controls.current;
          c.zoom = Math.min(1.45, Math.max(0.62, c.zoom * (1 + e.deltaY * 0.0012)));
        }}
      >
        <StudioCanvas
          config={shown}
          pose={pose}
          expression={expression}
          controls={controls}
          insets={{ left: RAIL_WIDTH + 24, right: panelWidth + 24 }}
          faceHead={faceHead}
        />
      </div>

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-5 pt-5">
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            type="button"
            onClick={leave}
            onMouseLeave={() => setConfirmLeave(false)}
            className={confirmLeave ? BTN.danger : BTN.secondary}
          >
            <IconArrowLeft size={18} />
            {confirmLeave ? "Discard changes?" : firstTime ? "Back to title" : "Back"}
          </button>
          <div>
            <p className={`${SUN_RIBBON} -rotate-2`}>
              <span
                aria-hidden
                className="h-2 w-2 rounded-full border-2 border-walnut bg-tangerine"
              />
              {firstTime ? "Step 1 of 2 · Your look" : "Your character"}
            </p>
            <h1 className="mt-1 font-display text-[28px] leading-tight font-bold tracking-[-0.01em] text-walnut">
              Character Studio
            </h1>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[16px] border-[3px] border-walnut bg-surface p-1 shadow-[0_4px_0_#1f1a16]">
            <button
              type="button"
              onClick={undo}
              disabled={!past.length}
              title="Undo (Ctrl+Z)"
              className={TOOL_BTN}
            >
              <IconUndo />
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!future.length}
              title="Redo (Ctrl+Shift+Z)"
              className={TOOL_BTN}
            >
              <IconRedo />
              Redo
            </button>
            <button
              type="button"
              onClick={() => {
                commit(initialConfig);
                setHead(initialHead);
                notify(firstTime ? "Back to the starting look" : "Back to your saved look");
              }}
              disabled={!dirty}
              className={TOOL_BTN}
            >
              <IconRefresh size={16} />
              Reset
            </button>
          </div>
          <button type="button" onClick={() => setCardOpen(true)} className={BTN.primary}>
            {firstTime ? "Continue" : "Save look"}
            <IconArrowRight size={18} />
          </button>
        </div>
      </header>

      {/* Left column: categories, then the randomizer */}
      <div
        className="pointer-events-none absolute top-24 bottom-5 left-5 flex flex-col gap-3"
        style={{ width: RAIL_WIDTH }}
      >
        <nav
          aria-label="Categories"
          className={`${PANEL} pointer-events-auto relative mt-2 flex min-h-0 flex-1 flex-col p-2 pt-4`}
        >
          <span className={`${RIBBON} absolute -top-3.5 left-4`}>Categories</span>
          <span className="absolute -top-3 right-4 flex items-center gap-1">
            <Keycap>Q</Keycap>
            <Keycap>E</Keycap>
          </span>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5 [scrollbar-width:thin]">
            {CATEGORIES.map((c: Category, i) => {
              const active = i === catIndex;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => goCategory(i)}
                    className={`relative flex h-11 w-full items-center gap-3 rounded-[14px] border-[2.5px] px-3 text-left font-display text-[15px] font-semibold transition-[background-color,border-color,color,translate] duration-150 ease-out active:translate-y-px motion-reduce:transition-none ${FOCUS} ${active ? "border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]" : "border-transparent text-walnut/75 hover:border-walnut/30 hover:bg-canvas hover:text-walnut"}`}
                  >
                    <Icon id={c.icon} className="h-5 w-5" />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {active && (
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut bg-tangerine"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Randomizer */}
        <div className={`${PANEL} pointer-events-auto relative mt-3 shrink-0 p-4 pt-5`}>
          <span className={`${SUN_RIBBON} absolute -top-3.5 left-4 rotate-[-2deg]`}>
            Surprise me
          </span>
          <span className="absolute -top-3 right-4">
            <Keycap>R</Keycap>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={style}
            onChange={(e) => setStyle(Number(e.target.value))}
            aria-label="Randomizer style, minimal to playful"
            className={`${RANGE} ${RANGE_TRACK_PLAYFUL} mt-1`}
          />
          <div className="flex justify-between font-display text-xs font-medium text-ink-soft">
            <span>Minimal</span>
            <span>Playful</span>
          </div>
          <button type="button" onClick={randomize} className={`${BTN.secondary} mt-3 w-full`}>
            <IconDice />
            Randomize
          </button>
        </div>
      </div>

      {/* Options panel */}
      <aside
        aria-label={`${category.label} options`}
        className={`${PANEL} absolute top-24 right-5 bottom-5 flex flex-col overflow-hidden`}
        style={{ width: panelWidth }}
      >
        <div
          key={category.id}
          className={`studio-slide-in flex items-center gap-3.5 border-b-2 border-dashed ${DIVIDER} px-5 pt-5 pb-4`}
        >
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 -rotate-6 place-items-center rounded-[14px] border-[2.5px] border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]"
          >
            <Icon id={category.icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[24px] leading-tight font-bold text-walnut">
              {category.label}
            </h2>
            <p className="text-[13px] leading-5 font-medium text-ink-soft">{category.blurb}</p>
          </div>
        </div>
        <div
          key={`${category.id}-body`}
          className="studio-slide-in min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 [scrollbar-width:thin]"
        >
          {category.sections.map(renderSection)}
        </div>
        <div
          className={`flex items-center justify-between gap-2 border-t-2 border-dashed ${DIVIDER} px-3 py-2.5`}
        >
          <button
            type="button"
            onClick={() => goCategory(catIndex - 1)}
            className={`${BTN_SM.quiet} max-w-[40%]`}
          >
            <IconChevronLeft size={16} />
            <span className="sr-only">Previous category: </span>
            <span className="truncate">{prevCategory.label}</span>
          </button>
          <span className="tabular shrink-0 rounded-full border-2 border-walnut bg-canvas px-2.5 py-0.5 font-display text-xs font-semibold text-walnut">
            {catIndex + 1} of {CATEGORIES.length}
          </span>
          <button
            type="button"
            onClick={() => goCategory(catIndex + 1)}
            className={`${BTN_SM.quiet} max-w-[40%]`}
          >
            <span className="sr-only">Next category: </span>
            <span className="truncate">{nextCategory.label}</span>
            <IconChevronRight size={16} />
          </button>
        </div>
      </aside>

      {/* Preview toolbar */}
      <div
        className="pointer-events-none absolute bottom-5 flex -translate-x-1/2 flex-col items-center gap-2"
        style={{ left: centre }}
      >
        <div className={`${TOOLBAR} flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5`}>
          <Segmented
            label="View"
            items={VIEWS}
            value={view as never}
            onChange={(id) => {
              setView(id);
              controls.current.targetYaw =
                VIEWS.find((v) => v.id === id)!.yaw +
                Math.round(controls.current.targetYaw / (Math.PI * 2)) * Math.PI * 2;
            }}
          />
          <Segmented label="Pose" items={POSES} value={pose} onChange={setPose} />
        </div>
        <div className={TOOLBAR}>
          <Segmented
            label="Expression"
            items={EXPRESSIONS}
            value={expression}
            onChange={setExpression}
          />
        </div>
        <p className="rounded-full border-2 border-walnut/20 bg-surface px-3 py-0.5 font-display text-xs font-medium text-ink-soft">
          Drag to turn, scroll to zoom, or use the arrow keys
        </p>
      </div>

      {loading && (
        <div
          className="pointer-events-none absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center gap-3 text-center"
          style={{ left: centre }}
        >
          <span
            aria-hidden
            className="h-10 w-10 rounded-full border-4 border-walnut/15 border-t-tangerine motion-safe:animate-spin"
          />
          <span className="rounded-full border-[3px] border-walnut bg-surface px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
            Loading the wardrobe… <span className="tabular">{Math.round(progress)}%</span>
          </span>
          <span
            aria-hidden
            className="block h-3.5 w-48 overflow-hidden rounded-full border-[2.5px] border-walnut bg-surface"
          >
            <span
              className="block h-full rounded-full bg-leaf transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </span>
        </div>
      )}

      {toast && (
        <div
          className="pointer-events-none absolute top-24 -translate-x-1/2"
          style={{ left: centre }}
        >
          <div
            key={toast.id}
            role="status"
            className="title-pop flex items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-2 font-display text-[14px] font-semibold whitespace-nowrap text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            <span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-leaf" />
            {toast.text}
          </div>
        </div>
      )}

      {cardOpen && (
        <LibraryCard
          config={draft}
          initialName={initialName}
          confirmLabel={firstTime ? "Enter the library" : "Save changes"}
          onBack={() => setCardOpen(false)}
          onConfirm={(name) => {
            useProfileStore.getState().setHead(head);
            onSave(name, draft);
          }}
        />
      )}
    </div>
  );
}
