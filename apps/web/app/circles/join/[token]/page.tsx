import type { Metadata } from "next";
import { CirclesShell } from "@/components/circles/CirclesShell";
import { JoinCircle } from "@/components/circles/JoinCircle";

/** The token is the invite itself: keep it out of Referer headers and search engines. */
export const metadata: Metadata = {
  title: "Join a Study Circle · OVR",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <CirclesShell>
      <h1 className="sr-only">Join a Study Circle</h1>
      <JoinCircle token={token} />
    </CirclesShell>
  );
}
