"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { useApi } from "@/components/progress/api";
import { IconArrowLeft, IconWarning } from "@/components/ui/icons";
import { BTN, PAGE } from "@/components/ui/styles";
import { updateItem } from "@/lib/library/client";
import type { ItemDetail } from "@/lib/library/types";
import { Spinner } from "./parts";

// The player uses browser audio and speech: client only, loaded when a lesson opens.
const LessonPlayer = dynamic(
  () => import("@/components/learning-studio/LessonPlayer").then((m) => m.LessonPlayer),
  { ssr: false, loading: () => <Opening /> },
);

function Opening() {
  return (
    <div className={`${PAGE} pt-10`}>
      <p
        role="status"
        className="inline-flex -rotate-2 items-center gap-2.5 rounded-full border-[3px] border-walnut bg-surface px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]"
      >
        <Spinner />
        Opening your lesson…
      </p>
    </div>
  );
}

/**
 * A lesson from your library in the Learning Studio's player. Your place is saved back to the
 * library as you go (and the usual lesson XP still comes from the learning API).
 */
export function SavedLessonPlayer({
  collectionId,
  itemId,
  onExit,
}: {
  collectionId: string;
  itemId: string;
  onExit: () => void;
}) {
  const { data, error, loading, reload } = useApi<ItemDetail>(
    `/api/me/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
  );
  const last = useRef("");

  if (!data?.lesson) {
    if (loading) return <Opening />;
    const message = error
      ? error.status === 404
        ? "That lesson isn't in your library any more."
        : error.message
      : "That item isn't a lesson.";
    return (
      <div className={`${PAGE} pt-10`}>
        <div
          role="alert"
          className="max-w-[560px] rounded-[20px] border-[3px] border-walnut bg-[#fbe9e5] p-5 text-walnut shadow-[0_4px_0_#1f1a16]"
        >
          <p className="flex items-center gap-2 font-display text-[18px] font-semibold">
            <IconWarning size={20} className="text-danger" />
            Couldn&apos;t open the lesson
          </p>
          <p className="mt-1 text-[15px] font-medium">{message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={BTN.secondary} onClick={onExit}>
              <IconArrowLeft size={18} />
              Back to my library
            </button>
            {error && error.status !== 404 && (
              <button type="button" className={BTN.primary} onClick={reload}>
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const progress = data.item.lesson?.progress ?? { scene: 0, completed: false };
  return (
    <LessonPlayer
      lesson={data.lesson.lesson}
      chunks={data.lesson.chunks}
      startScene={progress.completed ? 0 : progress.scene}
      onProgress={(scene, completed) => {
        const key = `${scene}:${completed}`;
        if (key === last.current) return;
        last.current = key;
        // Fire and forget: losing one bookmark update must never interrupt the lesson.
        updateItem(collectionId, itemId, { progress: { scene, completed } }, true).catch(() => {});
      }}
      onExit={onExit}
    />
  );
}
