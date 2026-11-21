"use client";

import { useEffect, useState } from "react";
import { HUD_CHIP, HUD_MUTED } from "@/components/ui/styles";
import { XP_EVENT } from "@/lib/learning/client";

const SHOW_MS = 3200;

/** "+25 XP · Lesson completed", briefly, whenever the server awards learning XP. */
export function XpToast() {
  const [items, setItems] = useState<{ id: number; xp: number; label: string }[]>([]);
  useEffect(() => {
    let next = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onXp = (e: Event) => {
      const { xp, label } = (e as CustomEvent<{ xp: number; label: string }>).detail;
      const id = next++;
      setItems((list) => [...list.slice(-2), { id, xp, label }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setItems((list) => list.filter((item) => item.id !== id));
      }, SHOW_MS);
      timers.add(timer);
    };
    window.addEventListener(XP_EVENT, onXp);
    return () => {
      window.removeEventListener(XP_EVENT, onXp);
      for (const t of timers) clearTimeout(t);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-20 z-[13] flex flex-col items-center gap-2 px-4"
    >
      {items.map((item) => (
        <p
          key={item.id}
          className={`${HUD_CHIP} title-pop flex items-center gap-2.5 py-1.5 pr-4 pl-1.5 text-[14px] leading-5 font-semibold`}
        >
          {/* The amount on a tilted sun badge, like the title screen's stickers. */}
          <span className="tabular inline-flex -rotate-3 items-center rounded-full border-2 border-black/80 bg-sun px-2.5 py-0.5 text-[14px] font-bold text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]">
            +{item.xp} XP
          </span>
          <span aria-hidden className={HUD_MUTED}>
            ·
          </span>
          <span>{item.label}</span>
        </p>
      ))}
    </div>
  );
}
