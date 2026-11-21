import type { Metadata } from "next";
import { Badge, CirclesShell } from "@/components/circles/CirclesShell";
import { CirclesHome } from "@/components/circles/CirclesHome";
import { DotRow } from "@/components/progress/ui";
import { BODY_L, DISPLAY_L } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Study Circles · Cram Club" };

export default function CirclesPage() {
  return (
    <CirclesShell>
      <Badge>Study together</Badge>
      <h1 className={`${DISPLAY_L} mt-5`}>Study Circles</h1>
      <DotRow className="mt-4" />
      <p className={`${BODY_L} mt-4 max-w-[60ch]`}>
        A circle is a shared shelf for your study group: links, notes, study plans and lessons from
        the Librarian. The owner decides who can add things and who can only read.
      </p>
      <div className="mt-8 sm:mt-10">
        <CirclesHome />
      </div>
    </CirclesShell>
  );
}
