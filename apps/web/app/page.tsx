import Link from "next/link";
import { DesktopNotice } from "@/components/ui/DesktopNotice";
import { HeroIllustration } from "@/components/ui/HeroIllustration";

type FeatureStatus = "open" | "soon";

const FEATURES: { title: string; body: string; status: FeatureStatus }[] = [
  {
    title: "Walk the library",
    body: "One grand, sunlit reading hall with an upper gallery. Move with WASD and switch between first and third person whenever you like.",
    status: "open",
  },
  {
    title: "Find your seat",
    body: "Settle in at one of the hall's long study tables, or take the lift up to a quiet desk in the gallery.",
    status: "open",
  },
  {
    title: "Study with others",
    body: "Public rooms of up to 15 students who can see each other move, sit and set their study status.",
    status: "soon",
  },
  {
    title: "Talk when you're near",
    body: "Optional proximity voice: people at your table sound close, people across the room fade out.",
    status: "soon",
  },
  {
    title: "Shared whiteboards",
    body: "Every study table gets its own board for drawing and writing together.",
    status: "soon",
  },
  {
    title: "An AI teacher",
    body: "Upload your notes as a PDF and get a short narrated lesson with visuals, questions and a teacher who answers from your notes.",
    status: "open",
  },
  {
    title: "Expression tracking",
    body: "Optional and processed on your device: your avatar nods, blinks and smiles with you. Your video never leaves your computer.",
    status: "soon",
  },
];

function StatusTag({ status }: { status: FeatureStatus }) {
  return status === "open" ? (
    <span className="rounded-full bg-sage/15 px-2.5 py-0.5 text-xs font-bold text-sage-dark">
      Open now
    </span>
  ) : (
    <span className="rounded-full bg-ink/8 px-2.5 py-0.5 text-xs font-bold text-ink-soft">
      Coming soon
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl font-semibold tracking-tight">OVR</span>
        <Link
          href="/library"
          className="rounded-full px-4 py-2 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink"
        >
          Enter Library →
        </Link>
      </header>
      <div className="mx-auto -mt-2 max-w-6xl px-6 text-right">
        <Link href="/learning-studio" className="text-sm font-bold text-wood hover:underline">
          🎓 AI Learning Studio
        </Link>
      </div>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="grid items-center gap-12 py-10 lg:grid-cols-[1.05fr_1fr] lg:py-16">
          <div>
            <p className="mb-4 text-sm font-bold tracking-[0.18em] text-wood uppercase">
              A virtual library
            </p>
            <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
              A cozy library to study in, together.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
              Walk into a warm, stylized university library as your own avatar. Find a seat, settle
              in, and study alongside other students with no camera and no pressure.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/library"
                className="rounded-full bg-ink px-7 py-3.5 text-base font-bold text-cream shadow-[0_8px_24px_-8px_rgb(45_36_32/0.6)] transition hover:-translate-y-0.5 hover:bg-wood-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
              >
                Enter Library
              </Link>
              <span className="text-sm text-ink-soft">No sign-up needed · Best on a computer</span>
            </div>
            <DesktopNotice className="mt-6 max-w-xl" />
          </div>
          <div className="overflow-hidden rounded-[28px] shadow-[0_30px_60px_-30px_rgb(70_45_25/0.55)]">
            <HeroIllustration />
          </div>
        </section>

        <section aria-labelledby="features" className="pt-10">
          <h2 id="features" className="font-display text-3xl font-semibold tracking-tight">
            What&apos;s inside
          </h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            OVR is being built in stages. Here&apos;s what you can do today and what&apos;s on the
            way.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li
                key={f.title}
                className={`rounded-3xl border p-6 ${
                  f.status === "open" ? "border-sage/30 bg-cream" : "border-ink/10 bg-cream/50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-semibold">{f.title}</h3>
                  <StatusTag status={f.status} />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-ink/10 py-8 text-center text-sm text-ink-soft">
        OVR · a place to study together
      </footer>
    </div>
  );
}
