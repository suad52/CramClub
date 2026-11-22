"use client";

import { useEffect, useId, useState } from "react";
import { useApi } from "@/components/progress/api";
import { formatMinutes, formatNumber, formatTime, plural } from "@/components/progress/format";
import { CARD, ICON_DOT, NOTE, SectionTitle, StateCard } from "@/components/progress/ui";
import {
  IconCheck,
  IconClock,
  IconInfo,
  IconRefresh,
  IconUsers,
  IconWarning,
} from "@/components/ui/icons";
import { BTN_SM, RIBBON, TAG } from "@/components/ui/styles";
import { formatBytes, formatDuration } from "@/lib/proof/format";
import { type ReplayResult, type TicketUse, runReplayTest } from "@/lib/proof/replay";
import type {
  AggregateFacts,
  IntegrityCheck,
  JobFacts,
  ProofReport,
  TigerFacts,
  VultrFacts,
} from "@/lib/proof/types";
import { gameHttpUrl } from "@/lib/proof/urls";

/*
 * The /proof page's live report: one panel per sponsor (Vultr, Tiger Data, Auth0, then ElevenLabs,
 * Gemini and TinyFish), each saying what runs where and showing the evidence from GET /api/proof
 * (lib/proof/types.ts). The browser itself checks the game server (GET /game/health) and runs the
 * ticket replay test (lib/proof/replay.ts) through the same public path a joining player uses.
 * A fact that couldn't be read says "unavailable"; nothing is filled in.
 */

const GAME_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
const PROOF_TICKET_URL = gameHttpUrl(GAME_URL, "/proof/ticket");
const GAME_HEALTH_URL = gameHttpUrl(GAME_URL, "/health");

type Tone = "ok" | "bad" | "wait" | "off";
const TONE: Record<Tone, string> = {
  ok: "bg-leaf",
  bad: "bg-[#fbe9e5] text-danger",
  wait: "bg-sun",
  off: "bg-canvas text-ink-soft",
};

/** A small status sticker: the word always says what it means, the colour only helps. */
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-walnut px-2.5 py-0.5 font-display text-[12.5px] leading-4 font-semibold text-walnut shadow-[0_2px_0_#1f1a16] ${TONE[tone]}`}
    >
      {tone === "ok" && <IconCheck size={13} strokeWidth={3} />}
      {tone === "bad" && <IconWarning size={13} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

const Unavailable = () => <span className="font-medium text-ink-soft">unavailable</span>;

/** Seconds as "6 s ago", "4 min ago", "3 h ago". */
function ago(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

/** How long before the report was made something happened ("3 min ago"), from server times. */
function since(iso: string | null, generatedAt: string) {
  if (!iso) return null;
  return ago((new Date(generatedAt).getTime() - new Date(iso).getTime()) / 1000);
}

function Panel({
  id,
  sponsor,
  title,
  lead,
  children,
}: {
  id: string;
  sponsor: string;
  title: string;
  lead: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${CARD} mt-4 scroll-mt-6 pt-9`}>
      <p className={`${RIBBON} absolute -top-4 left-5`}>{sponsor}</p>
      <h2
        id={`${id}-title`}
        className="font-display text-[24px] leading-tight font-bold text-walnut sm:text-[28px]"
      >
        {title}
      </h2>
      <div className="mt-2 max-w-[72ch] text-[15px] leading-6 font-medium text-ink-soft">
        {lead}
      </div>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

/** A muted inner card for one group of facts. */
function Box({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div
      aria-labelledby={id}
      role="group"
      className="rounded-[20px] border-2 border-walnut/25 bg-canvas p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={id} className="font-display text-[17px] leading-6 font-semibold text-walnut">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2.5 text-[14px] leading-5 sm:grid-cols-[minmax(10rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-display font-semibold text-ink-soft">{k}</dt>
          <dd className="tabular font-semibold text-walnut">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const code = "rounded-md bg-surface px-1.5 py-px font-mono text-[12.5px] text-walnut";

/* ------------------------------------------------------------------ */

export function ProofView() {
  const report = useApi<ProofReport>("/api/proof");
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {[
            ["#vultr", "Vultr"],
            ["#tiger", "Tiger Data"],
            ["#auth0", "Auth0"],
            ["#services", "ElevenLabs · Gemini · TinyFish"],
          ].map(([href, label]) => (
            <a key={href} href={href} className={TAG.neutral}>
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {report.data && (
            <p className="tabular text-[13px] font-medium text-ink-soft">
              Read at {formatTime(report.data.generatedAt)} · reused for{" "}
              {report.data.cachedForSeconds} s
            </p>
          )}
          <button
            type="button"
            onClick={report.reload}
            disabled={report.loading}
            className={BTN_SM.secondary}
          >
            <IconRefresh size={15} strokeWidth={2.5} />
            {report.loading ? "Reading…" : "Read again"}
          </button>
        </div>
      </div>
      <div className="mt-2">
        {report.data ? (
          <>
            <VultrPanel r={report.data} v={report.data.vultr} />
            <TigerPanel t={report.data.tiger} generatedAt={report.data.generatedAt} />
            <Auth0Panel r={report.data} />
            <ServicesPanel r={report.data} />
            <p className="mt-6 flex items-start gap-2 text-[13px] leading-5 font-medium text-ink-soft">
              <IconInfo size={16} strokeWidth={2.25} className="mt-0.5 shrink-0" />
              Built in {formatNumber(report.data.buildMs)} ms from live reads. Groups of fewer than
              3 students are hidden, as on the community charts.
            </p>
          </>
        ) : report.error ? (
          <div className="mt-6">
            <StateCard
              tone="alert"
              title="Couldn't read the live report"
              action={
                <button type="button" onClick={report.reload} className={BTN_SM.secondary}>
                  Try again
                </button>
              }
            >
              {report.error.message}
            </StateCard>
          </div>
        ) : (
          <div role="status" className="mt-6 space-y-4">
            <span className="sr-only">Reading the live report</span>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden
                className="h-56 rounded-[24px] border-[3px] border-walnut/15 bg-surface-muted motion-safe:animate-pulse"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Vultr ---- */

type Health =
  | { status: "checking" }
  | { status: "off" }
  | { status: "ok"; maxPlayers: number | null }
  | { status: "down" };

function useGameHealth(): Health {
  const [health, setHealth] = useState<Health>(
    GAME_HEALTH_URL ? { status: "checking" } : { status: "off" },
  );
  useEffect(() => {
    if (!GAME_HEALTH_URL) return;
    let live = true;
    fetch(GAME_HEALTH_URL, { cache: "no-store", credentials: "omit" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: unknown;
          maxPlayersPerRoom?: unknown;
        } | null;
        if (!live) return;
        setHealth(
          res.ok && body?.ok === true
            ? {
                status: "ok",
                maxPlayers:
                  typeof body.maxPlayersPerRoom === "number" ? body.maxPlayersPerRoom : null,
              }
            : { status: "down" },
        );
      })
      .catch(() => live && setHealth({ status: "down" }));
    return () => {
      live = false;
    };
  }, []);
  return health;
}

function Service({
  name,
  what,
  tone,
  status,
}: {
  name: string;
  what: string;
  tone: Tone;
  status: React.ReactNode;
}) {
  return (
    <li className="relative flex flex-col rounded-[18px] border-[3px] border-walnut bg-surface p-4 shadow-[0_4px_0_#1f1a16]">
      <p className="font-display text-[16px] leading-5 font-semibold text-walnut">{name}</p>
      <p className="mt-1 text-[13px] leading-5 font-medium text-ink-soft">{what}</p>
      <p className="mt-auto pt-3">
        <Pill tone={tone}>{status}</Pill>
      </p>
    </li>
  );
}

function VultrPanel({ r, v }: { r: ProofReport; v: VultrFacts }) {
  const health = useGameHealth();
  const w = v.worker;
  return (
    <Panel
      id="vultr"
      sponsor="Vultr"
      title="One Vultr server runs the whole library"
      lead={
        <>
          A Vultr Cloud Compute server runs four containers (deploy/docker-compose.yml). Caddy
          terminates HTTPS with a Let&apos;s Encrypt certificate and routes{" "}
          <code className={code}>/game/*</code> to the Colyseus game server and everything else to
          the Next.js web app. A separate worker container turns lesson requests into lessons and
          narration in the background. Generated files go to a private Vultr Object Storage bucket.
        </>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Service
          name="Caddy"
          what="HTTPS and routing, in front of everything"
          tone={r.served.https ? "ok" : "off"}
          status={
            r.served.https
              ? "This page came through it over HTTPS"
              : "Not in front of this copy (local)"
          }
        />
        <Service
          name="Web app · Next.js"
          what="Pages, the API, Auth0 sign-in, this report"
          tone="ok"
          status={`Built this report in ${formatNumber(r.buildMs)} ms`}
        />
        <Service
          name="Game server · Colyseus"
          what="Live rooms: positions, seats, faces, at /game"
          tone={health.status === "ok" ? "ok" : health.status === "checking" ? "wait" : "off"}
          status={
            health.status === "ok"
              ? `Answering${health.maxPlayers ? `, up to ${health.maxPlayers} a room` : ""}`
              : health.status === "checking"
                ? "Checking from your browser…"
                : health.status === "off"
                  ? "Not configured here"
                  : "Not reachable from your browser"
          }
        />
        <Service
          name="Worker"
          what="Background lessons: research, writing, narration"
          tone={!w ? "off" : w.online ? "ok" : "off"}
          status={
            !w
              ? "unavailable"
              : w.lastSeenSecondsAgo === null
                ? "No check-in yet"
                : `${w.online ? "Checked in" : "Last seen"} ${ago(w.lastSeenSecondsAgo)}`
          }
        />
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <Box
          title="Lesson queue"
          aside={<span className="text-[12.5px] font-semibold text-ink-soft">lesson_jobs</span>}
        >
          <p className="mb-3 text-[13.5px] leading-5 font-medium text-ink-soft">
            A Postgres table, no extra queue service: the worker claims rows with{" "}
            <code className={code}>FOR UPDATE SKIP LOCKED</code> and a lease, and saves a checkpoint
            after each step so a retry resumes instead of paying twice.
          </p>
          {v.jobs ? (
            <ul className="flex flex-wrap gap-2">
              {Object.entries(v.jobs).map(([status, n]) => (
                <li key={status} className={n > 0 ? TAG.brass : TAG.neutral}>
                  <span className="tabular">{formatNumber(n)}</span>&nbsp;
                  {status.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable />
          )}
        </Box>

        <Box title="Last finished lesson job">
          {v.lastCompleted ? (
            <>
              <Facts
                rows={[
                  [
                    "Finished",
                    <>
                      {formatTime(v.lastCompleted.completedAt)} (
                      {since(v.lastCompleted.completedAt, r.generatedAt)})
                    </>,
                  ],
                  [
                    "Queued to done",
                    `${formatDuration(v.lastCompleted.tookSeconds)} · ${plural(v.lastCompleted.attempts, "attempt")}`,
                  ],
                ]}
              />
              <p className="mt-3 font-display text-[13px] font-semibold text-ink-soft">
                Checkpoints it saved
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                <li>
                  <Pill tone={v.lastCompleted.research ? "ok" : "off"}>
                    {v.lastCompleted.research
                      ? `Research: ${plural(v.lastCompleted.research.sources, "source")} (${v.lastCompleted.research.from === "tinyfish" ? "TinyFish" : "the Librarian"})`
                      : "No research step"}
                  </Pill>
                </li>
                <li>
                  <Pill tone={v.lastCompleted.lessonStored ? "ok" : "off"}>
                    Lesson document stored
                  </Pill>
                </li>
                <li>
                  <Pill
                    tone={
                      v.lastCompleted.narration.recorded > 0 &&
                      v.lastCompleted.narration.recorded === v.lastCompleted.narration.scenes
                        ? "ok"
                        : "off"
                    }
                  >
                    Narration {v.lastCompleted.narration.recorded}
                    {v.lastCompleted.narration.scenes !== null &&
                      ` of ${v.lastCompleted.narration.scenes}`}{" "}
                    scenes
                  </Pill>
                </li>
                <li>
                  <Pill tone={v.lastCompleted.storage === "vultr" ? "ok" : "off"}>
                    Files on{" "}
                    {v.lastCompleted.storage === "vultr"
                      ? "Vultr Object Storage"
                      : (v.lastCompleted.storage ?? "unknown")}
                  </Pill>
                </li>
              </ul>
            </>
          ) : (
            <p className="text-[14px] font-medium text-ink-soft">
              {v.jobs ? "No lesson job has finished on this server yet." : <Unavailable />}
            </p>
          )}
        </Box>

        <Box title="Object storage">
          <Facts
            rows={[
              [
                "Driver",
                v.storage.driver === "vultr"
                  ? "Vultr Object Storage (S3 API), private bucket"
                  : v.storage.driver === "local"
                    ? "Local disk (development)"
                    : "Partly configured",
              ],
              [
                "Live ping",
                v.storage.reachable === null ? (
                  <Unavailable />
                ) : v.storage.reachable ? (
                  <Pill tone="ok">Answered in {formatNumber(v.storage.pingMs ?? 0)} ms</Pill>
                ) : (
                  <Pill tone="bad">No answer</Pill>
                ),
              ],
            ]}
          />
        </Box>

        <Box title="A signed URL, made just now">
          {v.signedUrl.status === "signed" ? (
            <>
              <Facts
                rows={[
                  ["Points at", v.signedUrl.host],
                  ["Signed with", v.signedUrl.algorithm],
                  [
                    "Works for",
                    `${v.signedUrl.expiresInSeconds} s (until ${formatTime(v.signedUrl.expiresAt)})`,
                  ],
                  [
                    "With the signature",
                    <StatusAnswer
                      key="s"
                      status={v.signedUrl.signedStatus}
                      good={(s) => s === 200 || s === 206}
                    />,
                  ],
                  [
                    "Without it",
                    <StatusAnswer
                      key="u"
                      status={v.signedUrl.unsignedStatus}
                      good={(s) => s === 403}
                      note="the bucket is private"
                    />,
                  ],
                ]}
              />
              <p className="mt-3 text-[12.5px] leading-5 font-medium text-ink-soft">
                The server signed a link to one stored narration clip and fetched one byte with and
                without the signature. The link itself is never shown: for a minute it would play a
                student&apos;s lesson.
              </p>
            </>
          ) : (
            <p className="text-[14px] leading-5 font-medium text-ink-soft">{v.signedUrl.reason}</p>
          )}
        </Box>
      </div>
    </Panel>
  );
}

const HTTP_WORDS: Record<number, string> = {
  200: "OK",
  206: "Partial Content",
  403: "Forbidden",
  404: "Not Found",
};

function StatusAnswer({
  status,
  good,
  note,
}: {
  status: number | null;
  good: (status: number) => boolean;
  note?: string;
}) {
  if (status === null) return <Unavailable />;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Pill tone={good(status) ? "ok" : "bad"}>
        {status} {HTTP_WORDS[status] ?? ""}
      </Pill>
      {note && good(status) && <span className="text-[13px] text-ink-soft">({note})</span>}
    </span>
  );
}

/* ---- Tiger Data ---- */

function jobLine(job: JobFacts | null, generatedAt: string) {
  if (!job) return <Unavailable />;
  const last = since(job.lastRunAt, generatedAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>
        {job.schedule}
        {last && `, last ran ${last}`}
        {job.lastDurationMs !== null && ` in ${job.lastDurationMs} ms`}
      </span>
      {job.lastStatus && (
        <Pill tone={job.lastStatus === "Success" ? "ok" : "bad"}>{job.lastStatus}</Pill>
      )}
      <span className="text-[12.5px] font-medium text-ink-soft">
        {plural(job.runs, "run")}, {plural(job.failures, "failure")}
      </span>
    </span>
  );
}

function TigerPanel({ t, generatedAt }: { t: TigerFacts | null; generatedAt: string }) {
  return (
    <Panel
      id="tiger"
      sponsor="Tiger Data"
      title="The study record is a TimescaleDB time series"
      lead={
        <>
          Every finished pomodoro, lesson and knowledge check is one row in the{" "}
          <code className={code}>learning_events</code> hypertable, written in the same transaction
          as its XP. Dashboards and both leaderboards read continuous aggregates with real-time
          aggregation, so the newest event counts at once, and the database itself enforces the
          rules that keep the numbers honest.
        </>
      }
    >
      {!t ? (
        <p className={NOTE}>
          <span className={`${ICON_DOT} h-6 w-6 bg-sun`}>
            <IconInfo size={14} strokeWidth={2.5} />
          </span>
          This copy has no database connected, so there&apos;s nothing live to show.
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Box title="Hypertable">
              {t.hypertable ? (
                <Facts
                  rows={[
                    [
                      "Table",
                      <code key="t" className={code}>
                        {t.hypertable.name}
                      </code>,
                    ],
                    [
                      "Chunks",
                      `${formatNumber(t.hypertable.chunks)} of ${t.hypertable.chunkInterval ?? "?"} each`,
                    ],
                    [
                      "In the columnstore",
                      <>
                        {plural(t.hypertable.compressedChunks, "chunk")}
                        {t.hypertable.bytesBefore !== null &&
                          t.hypertable.bytesAfter !== null &&
                          t.hypertable.compressedChunks > 0 &&
                          `: ${formatBytes(t.hypertable.bytesBefore)} → ${formatBytes(t.hypertable.bytesAfter)}`}
                      </>,
                    ],
                    [
                      "Segmented by",
                      `${t.hypertable.segmentBy ?? "?"}, ordered by ${t.hypertable.orderBy ?? "?"}`,
                    ],
                    ["Columnstore policy", jobLine(t.hypertable.policy, generatedAt)],
                  ]}
                />
              ) : (
                <Unavailable />
              )}
              {t.hypertable?.policy?.detail && (
                <p className="mt-3 text-[12.5px] leading-5 font-medium text-ink-soft">
                  The policy {t.hypertable.policy.detail}; nothing is ever deleted.
                </p>
              )}
            </Box>

            <Box
              title="Events in the last 24 hours"
              aside={
                <span className="tabular font-display text-[22px] leading-none font-bold text-walnut">
                  {formatNumber(t.events24h.total)}
                </span>
              }
            >
              {t.events24h.total ? (
                <ul className="flex flex-wrap gap-2">
                  {Object.entries(t.events24h.byType).map(([type, n]) => (
                    <li key={type} className={TAG.neutral}>
                      <span className="tabular">{formatNumber(n)}</span>&nbsp;
                      {type.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] font-medium text-ink-soft">A quiet day so far.</p>
              )}
            </Box>
          </div>

          <Box title="Continuous aggregates">
            <Aggregates list={t.aggregates} generatedAt={generatedAt} />
          </Box>

          <Integrity t={t} />

          <VerifiedWeeks t={t} />

          <Box title="Rules the database enforces itself">
            <p className="mb-3 text-[13.5px] leading-5 font-medium text-ink-soft">
              Read from the Postgres catalog just now. The app checks these too, but if it ever got
              one wrong, the database would refuse the write.
            </p>
            <ul className="divide-y-2 divide-walnut/10">
              {t.guarantees.map((g) => (
                <li
                  key={`${g.table}-${g.rule}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <Pill tone={g.present ? "ok" : "bad"}>{g.present ? g.kind : "missing"}</Pill>
                  <span className="min-w-0 flex-1 text-[14px] leading-5 font-semibold text-walnut">
                    {g.rule}
                  </span>
                  <code className={code}>{g.table}</code>
                </li>
              ))}
            </ul>
          </Box>
        </>
      )}
    </Panel>
  );
}

function Aggregates({ list, generatedAt }: { list: AggregateFacts[]; generatedAt: string }) {
  if (!list.length) return <Unavailable />;
  return (
    <ul className="space-y-3">
      {list.map((a) => (
        <li key={a.name} className="rounded-[16px] border-2 border-walnut/15 bg-surface p-3.5">
          <p className="flex flex-wrap items-center gap-2">
            <code className={`${code} font-semibold`}>{a.name}</code>
            <span className="text-[13px] font-medium text-ink-soft">
              built on <code className={code}>{a.builtOn}</code>
            </span>
            {a.hierarchical && <span className={TAG.brass}>Hierarchical</span>}
            {a.realTime && <span className={TAG.forest}>Real-time</span>}
          </p>
          <p className="mt-2 text-[13.5px] leading-5 font-medium text-walnut">
            <span className="font-display font-semibold text-ink-soft">Refresh: </span>
            {jobLine(a.refresh, generatedAt)}
          </p>
          {a.refresh?.detail && (
            <p className="mt-1 text-[12.5px] leading-5 font-medium text-ink-soft">
              It {a.refresh.detail}.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

const KEY_LABELS: Record<string, string> = {
  xp: "XP",
  focus: "focus",
  seen: "seen at desk",
  events: "events",
  sessions: "pomodoros",
};

function totals(values: Record<string, number> | null) {
  if (!values) return null;
  return Object.entries(values)
    .map(([k, v]) =>
      k === "focus" || k === "seen"
        ? `${formatMinutes(v / 60)} ${KEY_LABELS[k]}`
        : `${formatNumber(v)} ${KEY_LABELS[k] ?? k}`,
    )
    .join(" · ");
}

function CheckRow({ c }: { c: IntegrityCheck }) {
  const raw = totals(c.raw);
  const agg = totals(c.aggregate);
  return (
    <li className="rounded-[16px] border-2 border-walnut/15 bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-display text-[15px] leading-5 font-semibold text-walnut">
          {c.label}
        </p>
        <Pill tone={c.ok ? "ok" : "bad"}>
          {c.ok ? "Equal" : `${plural(c.drifted, "group")} differ`}
        </Pill>
      </div>
      <p className="tabular mt-2 text-[13px] leading-5 font-medium text-ink-soft">
        {plural(c.groups, "group")} compared (learner × day
        {c.id === "daily" ? " × subject" : ""})
      </p>
      {raw && agg ? (
        <dl className="tabular mt-1.5 grid gap-x-4 gap-y-1 text-[13px] leading-5 sm:grid-cols-[8.5rem_1fr]">
          <dt className="font-display font-semibold text-ink-soft">{c.sides.raw}</dt>
          <dd className="font-semibold text-walnut">{raw}</dd>
          <dt className="font-display font-semibold text-ink-soft">{c.sides.aggregate}</dt>
          <dd className="font-semibold text-walnut">{agg}</dd>
        </dl>
      ) : (
        <p className="mt-1.5 text-[12.5px] font-medium text-ink-soft">
          Totals hidden: fewer than 3 students this week.
        </p>
      )}
    </li>
  );
}

function Integrity({ t }: { t: TigerFacts }) {
  const report = t.integrity;
  return (
    <Box
      title="Integrity check: aggregates recomputed from raw rows"
      aside={
        report && (
          <Pill tone={report.ok ? "ok" : "bad"}>{report.ok ? "No drift" : "Drift found"}</Pill>
        )
      }
    >
      {!report ? (
        <Unavailable />
      ) : (
        <>
          <p className="mb-3 text-[13.5px] leading-5 font-medium text-ink-soft">
            Each read of this page recomputes the last 7 days ({report.from} to {report.to}, library
            time) straight from <code className={code}>learning_events</code> and{" "}
            <code className={code}>xp_ledger</code>, and compares them group by group with what the
            aggregates hold. Took {formatNumber(report.queryMs)} ms.
            {!report.ok &&
              report.nextRefreshAt &&
              ` Drift means rows were written into an already-materialised day; the next refresh (${formatTime(report.nextRefreshAt)}) folds them in.`}
          </p>
          <ul className="space-y-3">
            {report.checks.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
          <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Groups compared per day">
            {report.days.map((d) => (
              <li
                key={d.day}
                className={`rounded-[12px] border-2 border-walnut px-1 py-1.5 text-center shadow-[0_2px_0_#1f1a16] ${d.drifted ? "bg-[#fbe9e5]" : d.groups ? "bg-leaf" : "bg-surface"}`}
              >
                <span className="block font-display text-[11.5px] leading-4 font-semibold text-walnut">
                  {d.day.slice(5)}
                </span>
                <span className="tabular block text-[12px] leading-4 font-bold text-walnut">
                  {d.drifted ? `${d.drifted}≠` : formatNumber(d.groups)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Box>
  );
}

function VerifiedWeeks({ t }: { t: TigerFacts }) {
  const weeks = t.verifiedWeeks;
  return (
    <Box
      title="Verified focus, per week"
      aside={<code className={code}>focus_presence_weekly</code>}
    >
      <p className="mb-3 text-[13.5px] leading-5 font-medium text-ink-soft">
        When a student turns on their own face tracking, a finished pomodoro also reports how long
        they were seen at the desk. The server clamps it to the pomodoro&apos;s validated length and
        stores it on the event; a weekly hierarchical aggregate rolls it up from the daily one. It
        sits beside focus time as a ✓ and never changes a ranking: no camera is normal.
      </p>
      {weeks.length ? (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[34rem] text-[13.5px]">
            <thead className="font-display text-[12.5px] text-ink-soft">
              <tr>
                {["Week of", "Students", "Pomodoros", "With camera", "Focus", "✓ At desk"].map(
                  (h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`pb-2 font-semibold ${i ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="text-walnut">
              {weeks.map((w) => {
                const cell = (v: number | null, show = formatNumber) =>
                  v === null ? <span className="text-ink-soft">hidden</span> : show(v);
                return (
                  <tr key={w.week} className="border-t-2 border-walnut/10">
                    <th scope="row" className="py-1.5 text-left font-display font-semibold">
                      {w.week}
                    </th>
                    <td className="py-1.5 text-right">
                      {w.sessions === null ? (
                        <span className="text-ink-soft">&lt; 3</span>
                      ) : (
                        w.learners
                      )}
                    </td>
                    <td className="py-1.5 text-right">{cell(w.sessions)}</td>
                    <td className="py-1.5 text-right">{cell(w.sessionsWithCamera)}</td>
                    <td className="py-1.5 text-right">{cell(w.focusMinutes, formatMinutes)}</td>
                    <td className="py-1.5 text-right font-semibold text-sage-dark">
                      {cell(w.verifiedMinutes, formatMinutes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Unavailable />
      )}
    </Box>
  );
}

/* ---- Auth0 ---- */

function useReplayTest() {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{ run: number; value: ReplayResult } | null>(null);
  useEffect(() => {
    let live = true;
    void runReplayTest((input, init) => fetch(input, init), PROOF_TICKET_URL).then(
      (value) => live && setResult({ run, value }),
    );
    return () => {
      live = false;
    };
  }, [run]);
  return {
    result: result?.run === run ? result.value : null,
    again: () => setRun((n) => n + 1),
  };
}

function lineFor(u: TicketUse, expectAccept: boolean): { tone: Tone; text: string } {
  if (u.kind === "error")
    return {
      tone: "bad",
      text:
        u.status === null
          ? "Couldn't reach the game server"
          : u.code === "rate_limited"
            ? "Rate-limited: try again in a minute"
            : `Error ${u.status} (${u.code})`,
    };
  if (u.accepted) return { tone: expectAccept ? "ok" : "bad", text: "Accepted" };
  return {
    tone: expectAccept ? "bad" : "ok",
    text: `Refused (${u.reason.replace(/^ticket_/, "")})`,
  };
}

function ReplayTest() {
  const { result, again } = useReplayTest();
  const steps: { n: string; what: React.ReactNode; tone: Tone; text: string }[] = [];
  if (result?.status === "ran") {
    const first = lineFor(result.first, true);
    const second = lineFor(result.second, false);
    steps.push(
      {
        n: "1",
        what: (
          <>
            Asked the web app for a join ticket (<code className={code}>GET /api/net/ticket</code>)
          </>
        ),
        tone: "ok",
        text: `Signed, ${result.signedIn ? "for your account" : "for a guest"}${result.expiresAt ? `, good until ${formatTime(result.expiresAt)}` : ""}`,
      },
      {
        n: "2",
        what: (
          <>
            1st use at the game server (<code className={code}>POST /game/proof/ticket</code>)
          </>
        ),
        ...first,
      },
      { n: "3", what: "2nd use of the same ticket", ...second },
    );
  }
  return (
    <Box
      title="Live test: replay a join ticket"
      aside={
        <button type="button" onClick={again} disabled={!result} className={BTN_SM.secondary}>
          <IconRefresh size={15} strokeWidth={2.5} />
          {result ? "Run it again" : "Running…"}
        </button>
      }
    >
      <p className="mb-3 text-[13.5px] leading-5 font-medium text-ink-soft">
        To enter the library your browser gets a 5-minute ticket that the web app signs (HMAC) only
        after verifying your Auth0 session or guest cookie. The game server checks it on the live
        connection, before a seat is reserved, and each ticket works once. This test runs from your
        browser through the same public path, without putting anyone in a room.
      </p>
      {!result ? (
        <p role="status" className="text-[14px] font-semibold text-ink-soft">
          Running the test…
        </p>
      ) : result.status === "no_game_server" ? (
        <p className="text-[14px] font-medium text-ink-soft">
          This copy has no game server configured (NEXT_PUBLIC_GAME_SERVER_URL), so there&apos;s
          nothing to test.
        </p>
      ) : result.status === "no_ticket" ? (
        <p className="text-[14px] font-medium text-ink-soft">
          No ticket was issued: {result.message}
        </p>
      ) : (
        <>
          <ol className="space-y-2" aria-live="polite">
            {steps.map((s) => (
              <li key={s.n} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  className={`${ICON_DOT} h-7 w-7 bg-surface font-display text-[13px] font-bold`}
                  aria-hidden
                >
                  {s.n}
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-5 font-semibold text-walnut">
                  {s.what}
                </span>
                <Pill tone={s.tone}>{s.text}</Pill>
              </li>
            ))}
          </ol>
          <p
            className={`mt-4 font-display text-[16px] font-semibold ${result.passed ? "text-sage-dark" : "text-danger"}`}
          >
            {result.passed
              ? "Passed: the replayed ticket was refused."
              : "Didn't pass this time: see the steps above."}
          </p>
        </>
      )}
    </Box>
  );
}

function Auth0Panel({ r }: { r: ProofReport }) {
  const a = r.auth0;
  const c = a.counts;
  const count = (n: number | undefined, one: string, many?: string) =>
    c && n !== undefined ? plural(n, one, many) : "unavailable";
  return (
    <Panel
      id="auth0"
      sponsor="Auth0"
      title="Accounts are checked on every request, and on the live connection"
      lead={
        <>
          The web server reads the Auth0 session on each request; a student&apos;s id never comes
          from the browser. Guests get a signed cookie instead, and their progress moves to the
          account when they sign in.
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Box title="What an account unlocks">
          <Facts
            rows={[
              [
                "You, right now",
                <Pill key="you" tone={r.viewer.signedIn ? "ok" : "off"}>
                  {r.viewer.signedIn ? "Signed in" : "Not signed in"}
                </Pill>,
              ],
              ["Auth0 on this copy", a.configured ? "Configured" : "Not configured"],
              ["Linked accounts", count(c?.accounts, "account")],
              ["Study Circles", count(c?.circles, "circle")],
              ["Private table holds", count(c?.privateHolds, "hold")],
              ["Email invites", count(c?.emailInvites, "invite")],
            ]}
          />
          <ul className="mt-4 space-y-2 text-[13.5px] leading-5 font-medium text-ink-soft">
            <li className="flex gap-2">
              <IconUsers size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-walnut" />
              Study Circles, private tables and saved collections belong to an account.
            </li>
            <li className="flex gap-2">
              <IconCheck size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-walnut" />
              Inviting someone to a private table by email works only with an address Auth0 says is
              verified, and is stored as an HMAC hash, never the address.
            </li>
            <li className="flex gap-2">
              <IconClock size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-walnut" />
              Your name in the library comes from the signed join ticket, not from anything your
              browser sends.
            </li>
          </ul>
        </Box>
        <ReplayTest />
      </div>
    </Panel>
  );
}

/* ---- ElevenLabs, Gemini, TinyFish ---- */

function ServicesPanel({ r }: { r: ProofReport }) {
  const s = r.services;
  const n = (v: number | null, one: string, many?: string) =>
    v === null ? "unavailable" : plural(v, one, many);
  const rows: { sponsor: string; what: string; count: string }[] = [
    {
      sponsor: "ElevenLabs",
      what: "Ms. Fenwick's voice at the front desk, her quiet shush when a student with face tracking on drifts from the desk mid-pomodoro (head-pose numbers only, read on the student's own device), and the narration of every background lesson.",
      count: `${n(s.narrationClips, "narration clip")} stored`,
    },
    {
      sponsor: "Gemini",
      what: "Writes Ms. Fenwick's answers, study plans and the lessons with their knowledge checks. A second, independent pass re-answers every quiz question without the answer key and quotes the notes or sources word for word; a question that doesn't hold up is fixed or swapped for an open reflection (every section of a lesson asks something), and if the check can't run the lesson ships unchecked (GEMINI_QUIZ_CHECK_MODEL).",
      count: `${n(s.lessonsWritten, "background lesson")} finished · ${n(s.librarianAnswers, "Librarian request")} answered`,
    },
    {
      sponsor: "TinyFish",
      what: "Searches and reads the web for Ms. Fenwick's research and for lesson sources.",
      count: `${n(s.researchSources, "source")} found`,
    },
  ];
  return (
    <section id="services" aria-labelledby="services-title" className={`${CARD} mt-10 scroll-mt-6`}>
      <SectionTitle
        id="services-title"
        title="ElevenLabs, Gemini and TinyFish"
        sub="Where each one is used, with what this server has on record."
      />
      <ul className="divide-y-2 divide-walnut/10">
        {rows.map((row) => (
          <li key={row.sponsor} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-3">
            <span className={`${TAG.brass} mt-0.5`}>{row.sponsor}</span>
            <span className="min-w-0 flex-1 text-[14.5px] leading-6 font-medium text-walnut">
              {row.what}
            </span>
            <span className="tabular font-display text-[14px] font-semibold text-ink-soft">
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
