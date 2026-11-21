import "server-only";
import type { ResearchStep } from "../types";
import type { SourceForModel } from "./gemini";
import { domainOf, isBlockedSite, normalizeUrl } from "./notes";
import { type SearchHit, TinyFishError, fetchPages, search } from "./tinyfish";

/**
 * TinyFish quick research, shared by the Librarian's requests (lib/librarian/server/tasks.ts) and
 * the Living Library's background lesson jobs (lib/jobs/pipeline.ts). The caller decides where the
 * activity steps go and how cancellation is checked. Kept free of Next-only imports so the worker
 * process can run it.
 */

/** Pages to try reading: more than we keep, since some sites block automated reading. */
export const MAX_FETCH = 10;
const TRUSTED =
  /(\.edu|\.gov|\.ac\.[a-z]{2}|\.edu\.[a-z]{2}|(^|\.)(khanacademy\.org|openstax\.org|libretexts\.org|britannica\.com|nature\.com|ncbi\.nlm\.nih\.gov|nih\.gov|who\.int|mit\.edu|wikipedia\.org|developer\.mozilla\.org|bbc\.co\.uk|nasa\.gov|ck12\.org|mathsisfun\.com|physicsclassroom\.com|biologydictionary\.net))$/;

/** Search hits ranked for study: credible sources first, no answer mills, two pages per site at most. */
export function rankHits<T extends { url: string; position: number }>(
  hits: readonly T[],
  max: number,
) {
  const seen = new Set<string>();
  const perSite = new Map<string, number>();
  return hits
    .map((h) => {
      const d = domainOf(h.url);
      return { h, d, score: (TRUSTED.test(d) ? 10 : 0) - h.position * 0.6 };
    })
    .filter(({ d }) => d && !isBlockedSite(d))
    .sort((a, b) => b.score - a.score)
    .filter(({ h, d }) => {
      const key = normalizeUrl(h.url);
      if (seen.has(key) || (perSite.get(d) ?? 0) >= 2) return false;
      seen.add(key);
      perSite.set(d, (perSite.get(d) ?? 0) + 1);
      return true;
    })
    .slice(0, max)
    .map(({ h }) => h);
}

export interface ResearchHooks {
  /** Records one step TinyFish confirmed (search done, page read, page refused). */
  step(step: Omit<ResearchStep, "at">): Promise<void>;
  /** True when the work should stop (the student cancelled, or the worker lost its lease). */
  cancelled(): Promise<boolean>;
}

const domainList = (urls: readonly string[]) => [...new Set(urls.map(domainOf))].join(", ");

/**
 * TinyFish's quick research: it runs the searches, then reads the most promising pages (and
 * first, any links from the student's notes). Every step it logs is one TinyFish confirmed.
 * Returns the pages for Gemini to check, or null if the work was cancelled.
 */
export async function quickResearch(
  hooks: ResearchHooks,
  o: { queries: readonly string[]; links?: readonly string[] },
): Promise<SourceForModel[] | null> {
  const links = o.links ?? [];
  const linked = new Set(links.map(normalizeUrl));
  const hits: SearchHit[] = [];
  for (const q of o.queries.slice(0, 3)) {
    if (await hooks.cancelled()) return null;
    const found = await search(q);
    hits.push(...found);
    await hooks.step({
      kind: "search",
      label: `Searched “${q}” · ${found.length} results`,
    });
  }
  const picked = rankHits(
    hits.filter((h) => !linked.has(normalizeUrl(h.url))),
    MAX_FETCH - links.length,
  );
  if (!picked.length && !links.length)
    throw new TinyFishError("The searches found nothing usable.", "no_sources", 404, true);
  if (await hooks.cancelled()) return null;
  if (links.length)
    await hooks.step({
      kind: "note",
      label: `Opening ${links.length === 1 ? "the link" : `${links.length} links`} from your notes: ${domainList(links)}`,
    });
  if (picked.length)
    await hooks.step({
      kind: "note",
      label: `Reading ${picked.length} pages: ${domainList(picked.map((h) => h.url))}`,
    });
  const { pages, errors } = await fetchPages([...links, ...picked.map((h) => h.url)]);
  for (const p of pages)
    await hooks.step({
      kind: "fetch",
      label: `Read ${p.title || domainOf(p.finalUrl)}`,
      url: p.finalUrl,
    });
  for (const e of errors.slice(0, 6)) {
    const why = e.error === "bot_blocked" ? "the site blocks automated reading" : e.error;
    await hooks.step({
      kind: "error",
      label: linked.has(normalizeUrl(e.url))
        ? `Couldn't open ${domainOf(e.url)} from your notes (${why})`
        : `Couldn't open ${domainOf(e.url)} (${why}), so only its search snippet is used`,
      url: e.url,
    });
  }
  if (await hooks.cancelled()) return null;
  const read = new Set(pages.map((p) => normalizeUrl(p.url)));
  const sources: SourceForModel[] = pages.map((p) => {
    const hit = picked.find((h) => normalizeUrl(h.url) === normalizeUrl(p.url));
    return {
      title: p.title || hit?.title || domainOf(p.finalUrl),
      url: p.finalUrl,
      domain: domainOf(p.finalUrl),
      text: `${p.description}\n${p.text}`,
      ...(linked.has(normalizeUrl(p.url)) && { fromNotes: true }),
    };
  });
  // Pages that wouldn't open still count as found, by their search snippet, clearly marked.
  for (const h of picked)
    if (!read.has(normalizeUrl(h.url)) && h.snippet.length >= 60 && sources.length < MAX_FETCH)
      sources.push({
        title: h.title || domainOf(h.url),
        url: h.url,
        domain: domainOf(h.url),
        text: h.snippet,
        snippetOnly: true,
      });
  return sources;
}
