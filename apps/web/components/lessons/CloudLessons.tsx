"use client";

import { useState } from "react";
import { useApi } from "@/components/progress/api";
import { IconRefresh } from "@/components/ui/icons";
import { BTN_SM } from "@/components/ui/styles";
import { CardSkeleton } from "@/components/my-library/Items";
import { EMPTY, ERROR_LINE } from "@/components/my-library/parts";
import type { LessonJobView } from "@/lib/jobs/types";
import { LessonJobCard } from "./LessonJobCard";
import { MakeCloudLesson } from "./MakeCloudLesson";

/**
 * The Lessons tab's cloud half: the "Make a cloud lesson" form and every lesson the worker has
 * made or is making for you (GET /api/lessons, newest first). Each card keeps itself up to date.
 */
export function CloudLessons({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error, loading, reload } = useApi<{ jobs: LessonJobView[] }>("/api/lessons");
  // Lessons queued from this page, shown before the list catches up.
  const [added, setAdded] = useState<LessonJobView[]>([]);
  const listed = new Set(data?.jobs.map((j) => j.id));
  const jobs = [...added.filter((j) => !listed.has(j.id)), ...(data?.jobs ?? [])];

  return (
    <section aria-labelledby="cloud-lessons" className="space-y-6">
      <h3 id="cloud-lessons" className="sr-only">
        Cloud lessons
      </h3>
      <MakeCloudLesson
        onCreated={(job) => {
          setAdded((a) => [job, ...a]);
          reload();
        }}
      />
      {error && !data && (
        <p role="alert" className={`${ERROR_LINE} flex flex-wrap items-center gap-3`}>
          Couldn&apos;t load your cloud lessons: {error.message}
          <button type="button" className={BTN_SM.secondary} onClick={reload}>
            <IconRefresh size={15} />
            Try again
          </button>
        </p>
      )}
      {!data && loading && <CardSkeleton />}
      {data && jobs.length === 0 && (
        <p className={`${EMPTY} max-w-[820px]`}>
          No cloud lessons yet. Name a topic above, or ask Ms. Fenwick for an interactive lesson,
          and it&apos;ll appear here while it&apos;s being made.
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="max-w-[820px] space-y-6">
          {jobs.map((job) => (
            <li key={job.id}>
              <LessonJobCard job={job} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
