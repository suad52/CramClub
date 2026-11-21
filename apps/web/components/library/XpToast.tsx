"use client";

import { useEffect, useState } from "react";
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
          className="flex items-center gap-2 rounded-full bg-ink/90 px-4 py-2 text-sm font-bold text-cream shadow-xl backdrop-blur transition duration-300 ease-out starting:-translate-y-2 starting:opacity-0"
        >
          <span className="font-extrabold text-lamp">+{item.xp} XP</span>
          <span>{item.label}</span>
        </p>
      ))}
    </div>
  );
}
