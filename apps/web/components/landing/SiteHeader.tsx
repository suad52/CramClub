import Link from "next/link";
import { AccountChip } from "@/components/auth/AccountChip";
import { IconArrowRight } from "@/components/ui/icons";
import { BTN_SM, FOCUS, PAGE } from "@/components/ui/styles";

/**
 * The site's main destinations. Only routes that exist. The library itself ("/") isn't a pill:
 * the wordmark and "Enter the library" already go there, and the signed-in row has no room for a
 * third way in.
 */
const NAV = [
  { href: "/librarian", label: "Librarian" },
  { href: "/learning-studio", label: "Learning Studio" },
  { href: "/progress", label: "My progress" },
  { href: "/my-library", label: "My library" },
  { href: "/circles", label: "Study circles" },
] as const;

/**
 * "How it works" (/proof: what runs where, with live evidence, for the hackathon judges). It sits
 * in a slim strip over the bar rather than in the nav row, which is already full at every width
 * when signed in, and so it's there on phones too, where the nav row hides.
 */
const PROOF_HREF = "/proof";

export type SiteHref = "/" | (typeof NAV)[number]["href"] | typeof PROOF_HREF;

/**
 * Chunky pill links in the top bar: a walnut outline on hover, and the current page sits on a sun
 * sticker.
 */
const NAV_LINK = `inline-flex h-9 items-center rounded-full border-2 border-transparent px-3.5 font-display text-[14.5px] font-semibold text-ink-soft transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:border-walnut hover:bg-canvas hover:text-walnut active:translate-y-px motion-reduce:transition-none aria-[current=page]:border-walnut aria-[current=page]:bg-sun aria-[current=page]:text-walnut aria-[current=page]:shadow-[0_3px_0_#1f1a16] ${FOCUS}`;

/**
 * The top bar for the website pages: wordmark, the main destinations, your account and one way
 * into the library. Under md the links hide and only the wordmark, account and button stay.
 */
export function SiteHeader({ current }: { current?: SiteHref }) {
  return (
    <header className="border-b-[3px] border-walnut bg-surface">
      <div className="bg-walnut">
        <p
          className={`${PAGE} flex h-8 items-center justify-center gap-2 font-display text-[13px] font-semibold text-walnut-muted`}
        >
          <span className="hidden sm:inline">What runs where, with live evidence:</span>
          <Link
            href={PROOF_HREF}
            aria-current={current === PROOF_HREF ? "page" : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 text-walnut-text underline decoration-sun decoration-2 underline-offset-4 transition-colors duration-150 hover:text-sun aria-[current=page]:no-underline motion-reduce:transition-none ${FOCUS}`}
          >
            How it works
            <IconArrowRight size={14} strokeWidth={2.75} />
          </Link>
        </p>
      </div>
      <div className={`${PAGE} flex h-18 items-center justify-between gap-4`}>
        <Link
          href="/"
          aria-current={current === "/" ? "page" : undefined}
          className={`group flex items-center gap-3 rounded-[12px] ${FOCUS}`}
        >
          {/* The title screen's outlined wordmark, at header size. */}
          <span className="inline-block font-display text-[30px] leading-none font-bold tracking-tight text-surface transition-transform duration-150 ease-out [paint-order:stroke_fill] [text-shadow:0_3px_0_#1f1a16] [-webkit-text-stroke:6px_#1f1a16] group-hover:-rotate-3 motion-reduce:transition-none">
            Cram Club
          </span>
          {/* Only while the nav row is hidden: beside it, the row is too full to fit it. */}
          <span className="hidden font-display text-[13.5px] font-semibold text-ink-soft min-[400px]:inline md:hidden">
            The virtual library
          </span>
        </Link>

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current === item.href ? "page" : undefined}
                  className={NAV_LINK}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <AccountChip />
          <Link href="/" className={BTN_SM.primary}>
            Enter the library
          </Link>
        </div>
      </div>
    </header>
  );
}
