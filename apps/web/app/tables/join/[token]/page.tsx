import type { Metadata } from "next";
import { JoinTable } from "@/components/library/JoinTable";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { BTN_SM, PAGE } from "@/components/ui/styles";

/** The token is the invite itself: keep it out of Referer headers and search engines. */
export const metadata: Metadata = {
  title: "Join a private table · OVR",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function JoinTablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="relative min-h-dvh bg-canvas">
      {/* Sits above the page until a keyboard user tabs to it. */}
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className={`${PAGE} pt-8 pb-16 sm:pt-12 sm:pb-20`}>
        <h1 className="sr-only">Join a private table</h1>
        <JoinTable token={token} />
      </main>
    </div>
  );
}
