import type { Metadata } from "next";
import { CircleView } from "@/components/circles/CircleView";
import { CirclesShell } from "@/components/circles/CirclesShell";

export const metadata: Metadata = { title: "Study Circle · Cram Club", robots: { index: false } };

export default async function CirclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CirclesShell>
      <CircleView id={id} />
    </CirclesShell>
  );
}
