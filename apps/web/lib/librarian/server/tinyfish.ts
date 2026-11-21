import "server-only";

/**
 * TinyFish, the Librarian's web research layer. The only module that knows TinyFish's request
 * and response shapes (from docs.tinyfish.ai, read 2026-11-20):
 *   Search    GET  https://api.search.tinyfish.ai?query=…   → { results: [{ position, site_name, title, snippet, url }] }
 *   Fetch     POST https://api.fetch.tinyfish.ai { urls }    → { results: [{ url, final_url, title, description, text }], errors: [{ url, error }] }
 *   Research  POST https://agent.tinyfish.ai/v1/automation/run-research-async { query, mode }
 *               → { research_run_id }, then GET /v1/research-run/{id} (status, deep_result, research_plan,
 *               evidence) and POST /v1/research-run/{id}/cancel.
 * Every request carries the X-API-Key header. Nothing here is ever sent to the browser.
 */

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const AGENT_URL = "https://agent.tinyfish.ai";

export class TinyFishError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const tinyfishConfigured = () => !!process.env.TINYFISH_API_KEY;

async function call<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new TinyFishError("TINYFISH_API_KEY is not set.", "not_configured", 503, false);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "X-API-Key": key, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    throw new TinyFishError(
      timedOut ? "TinyFish took too long to answer." : "Couldn't reach TinyFish.",
      timedOut ? "timeout" : "network",
      504,
      true,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const code = body?.error?.code ?? `http_${res.status}`;
    const messages: Record<number, string> = {
      401: "The TinyFish API key was rejected.",
      402: "The TinyFish wallet is out of credits.",
      403: "This TinyFish account can't use that API.",
      429: "TinyFish is busy with other runs. Try again in a moment.",
    };
    throw new TinyFishError(
      messages[res.status] ?? body?.error?.message ?? `TinyFish answered ${res.status}.`,
      code,
      res.status,
      res.status === 429 || res.status >= 500,
    );
  }
  return (await res.json()) as T;
}

export interface SearchHit {
  position: number;
  title: string;
  url: string;
  snippet: string;
  siteName: string;
}

export async function search(query: string): Promise<SearchHit[]> {
  const data = await call<{
    results?: {
      position?: number;
      site_name?: string;
      title?: string;
      snippet?: string;
      url?: string;
    }[];
  }>(`${SEARCH_URL}?${new URLSearchParams({ query })}`, { method: "GET" }, 20_000);
  return (data.results ?? [])
    .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r, i) => ({
      position: r.position ?? i + 1,
      title: (r.title ?? "").trim(),
      url: r.url!,
      snippet: (r.snippet ?? "").trim(),
      siteName: (r.site_name ?? "").trim(),
    }));
}

/** Pages that are a bot check or an error shell, not the article. */
const CHALLENGE =
  /client challenge|just a moment|access denied|attention required|are you a (human|robot)|captcha|verify you are human|enable javascript and cookies/i;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  text: string;
}

/** Fetches up to 10 pages; returns the ones that worked and why the others didn't. */
export async function fetchPages(urls: string[]) {
  const data = await call<{
    results?: {
      url?: string;
      final_url?: string;
      title?: string;
      description?: string;
      text?: string;
    }[];
    errors?: { url?: string; error?: string }[];
  }>(FETCH_URL, { method: "POST", body: JSON.stringify({ urls: urls.slice(0, 10) }) }, 60_000);
  const usable = (r: { text?: string; title?: string }) =>
    (r.text ?? "").trim().length > 500 &&
    !CHALLENGE.test(`${r.title ?? ""} ${(r.text ?? "").slice(0, 300)}`);
  const pages: FetchedPage[] = (data.results ?? [])
    .filter((r) => r.url && usable(r))
    .map((r) => ({
      url: r.url!,
      finalUrl: r.final_url || r.url!,
      title: (r.title ?? "").trim(),
      description: (r.description ?? "").trim(),
      text: r.text ?? "",
    }));
  // A bot challenge or an empty shell isn't the page: report it like a failed fetch.
  const errors = [
    ...(data.errors ?? []).map((e) => ({ url: e.url ?? "", error: e.error ?? "failed" })),
    ...(data.results ?? [])
      .filter((r) => r.url && !usable(r))
      .map((r) => ({ url: r.url!, error: "no readable content" })),
  ];
  return { pages, errors };
}

export type ResearchRunStatus =
  "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface ResearchRun {
  status: ResearchRunStatus;
  report: string | null;
  citations: string[];
  terminationReason: string | null;
  /** Subquestions the run planned, when TinyFish reports them. */
  plan: string[];
  /** Evidence sources (URL, title, and the claims they support), when reported. */
  evidence: { url: string; title: string; claims: string[] }[];
}

export async function startResearch(query: string) {
  const data = await call<{ research_run_id?: string }>(
    `${AGENT_URL}/v1/automation/run-research-async`,
    { method: "POST", body: JSON.stringify({ query: query.slice(0, 10_000), mode: "deep" }) },
    30_000,
  );
  if (!data.research_run_id)
    throw new TinyFishError("TinyFish didn't return a run id.", "bad_response", 502, true);
  return data.research_run_id;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function getResearch(runId: string): Promise<ResearchRun> {
  const d = await call<Record<string, unknown>>(
    `${AGENT_URL}/v1/research-run/${encodeURIComponent(runId)}`,
    { method: "GET" },
    20_000,
  );
  const deep = (d.deep_result ?? null) as Record<string, unknown> | null;
  // research_plan and evidence aren't fully specified in the docs: read them defensively.
  const planRaw = d.research_plan as unknown;
  const plan: string[] = Array.isArray(planRaw)
    ? planRaw.map((p) => str((p as Record<string, unknown>)?.question) || str(p)).filter(Boolean)
    : Array.isArray((planRaw as Record<string, unknown>)?.subquestions)
      ? ((planRaw as Record<string, unknown>).subquestions as unknown[])
          .map((q) => str((q as Record<string, unknown>)?.question) || str(q))
          .filter(Boolean)
      : [];
  const evidenceRaw = Array.isArray(d.evidence) ? (d.evidence as Record<string, unknown>[]) : [];
  return {
    status: str(d.status) as ResearchRunStatus,
    report: deep ? str(deep.result) || null : null,
    citations: Array.isArray(deep?.citations)
      ? (deep.citations as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
    terminationReason: deep ? str(deep.termination_reason) || null : null,
    plan: plan.slice(0, 8),
    evidence: evidenceRaw
      .map((e) => ({
        url: str(e.url) || str(e.source_url),
        title: str(e.title),
        claims: Array.isArray(e.claims)
          ? (e.claims as unknown[])
              .map((c) => str((c as Record<string, unknown>)?.text) || str(c))
              .filter(Boolean)
          : [],
      }))
      .filter((e) => /^https?:\/\//.test(e.url)),
  };
}

export async function cancelResearch(runId: string) {
  await call(
    `${AGENT_URL}/v1/research-run/${encodeURIComponent(runId)}/cancel`,
    { method: "POST", body: "{}" },
    15_000,
  ).catch(() => {});
}
