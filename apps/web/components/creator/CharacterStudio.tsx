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
import { CATEGORIES, type Category, type FramingId, type Section, thumbUrl } from "./categories";
import { LibraryCard } from "./LibraryCard";
import {
  StudioCanvas,
  type StudioControls,
  type StudioExpression,
  type StudioPose,
  createStudioControls,
} from "./StudioCanvas";
import { Icon, Keycap, OptionTile, PresetCard, SectionTitle, Slider, Swatches } from "./ui";

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
  { id: "surprised", label: "Wow" },
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
    <div role="group" aria-label={label} className="flex rounded-full bg-ink/[0.06] p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition ${value === it.id ? "bg-ink text-cream shadow" : "text-ink-soft hover:text-ink"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The character studio: a game-style creator with a live 3D preview on a turntable,
 * category rail, Blender-rendered option tiles, swatches, presets and a style-aware
 * randomizer. Nothing is saved until the player signs their library card.
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
  const controls = useRef<StudioControls>(createStudioControls());
  const sliderStart = useRef<AvatarConfig | null>(null);
  const drag = useRef<{ x: number } | null>(null);
  const panelWidth = usePanelWidth();
  const { active: loading, progress } = useProgress();

  const category = CATEGORIES[catIndex]!;
  const shown = useMemo(() => (hover ? { ...draft, ...hover } : draft), [draft, hover]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialConfig);

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
      style < 0.34
        ? "A fresh, minimal look"
        : style > 0.66
          ? "Something playful"
          : "A brand-new look",
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
      case "presets":
        return (
          <div key={i} className="space-y-2.5">
            {AVATAR_PRESETS.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                active={JSON.stringify(p.config) === JSON.stringify(draft)}
                onPick={() => {
                  commit(p.config);
                  notify(`${p.label} applied — tweak anything you like`);
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
            {s.hint && <p className="-mt-1 mb-2.5 text-xs text-ink-soft">{s.hint}</p>}
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

  return (
    <div className="studio-bg fixed inset-0 z-50 overflow-hidden text-ink select-none studio-fade-in">
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
        />
      </div>

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={leave}
            onMouseLeave={() => setConfirmLeave(false)}
            className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-extrabold shadow-sm ring-1 backdrop-blur transition ${confirmLeave ? "bg-ember text-cream ring-ember" : "bg-cream/80 ring-ink/10 hover:bg-cream"}`}
          >
            <span aria-hidden>←</span>
            {confirmLeave ? "Discard changes?" : firstTime ? "Title" : "Back"}
          </button>
          <div className="rounded-2xl bg-cream/70 px-4 py-1.5 ring-1 ring-ink/10 backdrop-blur">
            <p className="text-[0.62rem] font-extrabold tracking-[0.22em] text-wood uppercase">
              {firstTime ? "Step 1 of 2 · Design" : "Wardrobe"}
            </p>
            <h1 className="font-display text-xl leading-tight font-semibold">Character Studio</h1>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex rounded-full bg-cream/80 p-1 shadow-sm ring-1 ring-ink/10 backdrop-blur">
            <button
              type="button"
              onClick={undo}
              disabled={!past.length}
              title="Undo (Ctrl+Z)"
              className="rounded-full px-3 py-1.5 text-sm font-extrabold disabled:opacity-35 hover:enabled:bg-ink/5"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!future.length}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded-full px-3 py-1.5 text-sm font-extrabold disabled:opacity-35 hover:enabled:bg-ink/5"
            >
              Redo ↷
            </button>
            <button
              type="button"
              onClick={() => {
                commit(initialConfig);
                notify(firstTime ? "Back to the starting look" : "Back to your saved look");
              }}
              disabled={!dirty}
              className="rounded-full px-3 py-1.5 text-sm font-extrabold disabled:opacity-35 hover:enabled:bg-ink/5"
            >
              Reset
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCardOpen(true)}
            className="h-11 rounded-full bg-sage-dark px-6 text-sm font-extrabold text-cream shadow-[0_10px_24px_-10px_rgb(86_115_79/0.9)] transition hover:bg-[#46623f] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            {firstTime ? "Done — next" : "Save look"} <span aria-hidden>→</span>
          </button>
        </div>
      </header>

      {/* Category rail */}
      <nav
        aria-label="Categories"
        className="absolute top-28 bottom-40 left-5 flex flex-col"
        style={{ width: RAIL_WIDTH }}
      >
        <div className="flex min-h-0 flex-1 flex-col rounded-3xl bg-cream/85 p-2 shadow-[0_20px_50px_-30px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 backdrop-blur">
          <div className="flex items-center justify-between px-2.5 pt-1 pb-2 text-[0.65rem] font-extrabold tracking-[0.16em] text-ink-soft uppercase">
            <span>Categories</span>
            <span className="flex items-center gap-1 normal-case">
              <Keycap>Q</Keycap>
              <Keycap>E</Keycap>
            </span>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
            {CATEGORIES.map((c: Category, i) => {
              const active = i === catIndex;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => goCategory(i)}
                    className={`group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm font-extrabold transition ${active ? "bg-ink text-cream shadow-md" : "text-ink-soft hover:bg-ink/5 hover:text-ink"}`}
                  >
                    <Icon id={c.icon} className={`h-5 w-5 shrink-0 ${active ? "text-lamp" : ""}`} />
                    {c.label}
                    {active && (
                      <span
                        className="absolute top-1/2 -right-2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-ember"
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Options panel */}
      <aside
        aria-label={`${category.label} options`}
        className="absolute top-24 right-5 bottom-5 flex flex-col overflow-hidden rounded-[1.75rem] bg-cream/92 shadow-[0_30px_70px_-35px_rgb(20_12_6/0.7)] ring-1 ring-ink/10 backdrop-blur-md"
        style={{ width: panelWidth }}
      >
        <div
          key={category.id}
          className="studio-slide-in flex items-center gap-3 border-b border-ink/10 px-5 pt-5 pb-4"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink text-lamp">
            <Icon id={category.icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight font-semibold">{category.label}</h2>
            <p className="text-xs leading-snug text-ink-soft">{category.blurb}</p>
          </div>
        </div>
        <div
          key={`${category.id}-body`}
          className="studio-slide-in min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 [scrollbar-width:thin]"
        >
          {category.sections.map(renderSection)}
        </div>
        <div className="flex items-center justify-between border-t border-ink/10 px-5 py-3 text-xs font-bold text-ink-soft">
          <button
            type="button"
            onClick={() => goCategory(catIndex - 1)}
            className="rounded-full px-2 py-1 hover:bg-ink/5 hover:text-ink"
          >
            ← {CATEGORIES[(catIndex - 1 + CATEGORIES.length) % CATEGORIES.length]!.label}
          </button>
          <span>
            {catIndex + 1} / {CATEGORIES.length}
          </span>
          <button
            type="button"
            onClick={() => goCategory(catIndex + 1)}
            className="rounded-full px-2 py-1 hover:bg-ink/5 hover:text-ink"
          >
            {CATEGORIES[(catIndex + 1) % CATEGORIES.length]!.label} →
          </button>
        </div>
      </aside>

      {/* Randomizer */}
      <div
        className="absolute bottom-5 left-5 rounded-3xl bg-cream/85 p-4 shadow-[0_20px_50px_-30px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 backdrop-blur"
        style={{ width: RAIL_WIDTH }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] font-extrabold tracking-[0.16em] text-ink-soft uppercase">
            Surprise me
          </span>
          <Keycap>R</Keycap>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={style}
          onChange={(e) => setStyle(Number(e.target.value))}
          aria-label="Randomizer style, minimal to playful"
          className="studio-range mt-2 w-full"
        />
        <div className="flex justify-between text-[0.7rem] font-extrabold text-ink-soft">
          <span>Minimal</span>
          <span>Playful</span>
        </div>
        <button
          type="button"
          onClick={randomize}
          className="group mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-sm font-extrabold text-cream transition hover:bg-wood-dark"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4.5 w-4.5 transition duration-300 group-hover:rotate-90"
            aria-hidden
          >
            <rect
              x="4"
              y="4"
              width="16"
              height="16"
              rx="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="9" cy="9" r="1.4" fill="currentColor" />
            <circle cx="15" cy="15" r="1.4" fill="currentColor" />
            <circle cx="15" cy="9" r="1.4" fill="currentColor" />
            <circle cx="9" cy="15" r="1.4" fill="currentColor" />
          </svg>
          Randomize
        </button>
      </div>

      {/* Preview toolbar */}
      <div
        className="pointer-events-none absolute bottom-5 flex -translate-x-1/2 flex-col items-center gap-2"
        style={{
          left: `calc(${RAIL_WIDTH + 24}px + (100% - ${RAIL_WIDTH + 24}px - ${panelWidth + 24}px) / 2)`,
        }}
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-[1.4rem] bg-cream/85 p-1.5 shadow-[0_20px_50px_-30px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 backdrop-blur">
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
        <div className="pointer-events-auto rounded-full bg-cream/85 p-1 shadow-[0_20px_50px_-30px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 backdrop-blur">
          <Segmented
            label="Expression"
            items={EXPRESSIONS}
            value={expression}
            onChange={setExpression}
          />
        </div>
        <p className="text-[0.7rem] font-bold text-ink-soft/80">
          Drag to turn · scroll to zoom · ← → to rotate
        </p>
      </div>

      {loading && (
        <div
          className="pointer-events-none absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center gap-2 text-center"
          style={{
            left: `calc(${RAIL_WIDTH + 24}px + (100% - ${RAIL_WIDTH + 24}px - ${panelWidth + 24}px) / 2)`,
          }}
        >
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-wood/20 border-t-wood" />
          <span className="text-sm font-bold text-ink-soft">
            Unpacking the wardrobe… {Math.round(progress)}%
          </span>
        </div>
      )}

      {toast && (
        <div
          key={toast.id}
          role="status"
          className="studio-toast pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-cream shadow-xl"
        >
          {toast.text}
        </div>
      )}

      {cardOpen && (
        <LibraryCard
          config={draft}
          initialName={initialName}
          confirmLabel={firstTime ? "Enter the library →" : "Save changes"}
          onBack={() => setCardOpen(false)}
          onConfirm={(name) => onSave(name, draft)}
        />
      )}
    </div>
  );
}
