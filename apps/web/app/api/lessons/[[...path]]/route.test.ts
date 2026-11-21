import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonJobView } from "@/lib/jobs/types";

/**
 * The cloud lessons API's own decisions (identity, access, CSRF, audio delivery), with the queue,
 * identity and storage stubbed: their behaviour has tests of its own.
 */

vi.mock("@/lib/learning/server/db", () => ({ db: vi.fn(() => ({}) as never) }));
vi.mock("@/lib/auth/currentUser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/currentUser")>();
  return { ...actual, currentUser: vi.fn(), requireUser: vi.fn() };
});
vi.mock("@/lib/jobs/server", async () => {
  const { z } = await import("zod");
  return {
    NewLessonJobSchema: z.object({ topic: z.string().trim().min(3).max(200) }).passthrough(),
    enqueueLessonJob: vi.fn(),
    getLessonJob: vi.fn(),
    listLessonJobs: vi.fn(),
    loadLesson: vi.fn(),
    retryLessonJob: vi.fn(),
    sceneAudio: vi.fn(),
  };
});
vi.mock("@/lib/storage", () => ({ getStorage: vi.fn() }));

const auth = await import("@/lib/auth/currentUser");
const jobs = await import("@/lib/jobs/server");
const storage = await import("@/lib/storage");
const route = await import("./route");

const ID = "7d1f3c2e-8a4b-4c6d-9e0f-112233445566";
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/lessons${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/lessons${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });

const view = (over: Partial<LessonJobView> = {}): LessonJobView => ({
  id: ID,
  topic: "Modular arithmetic",
  status: "completed",
  busy: false,
  progress: null,
  title: "Clock maths",
  summary: "Remainders",
  sceneCount: 2,
  audio: [{ scene: 0, duration: 12 }],
  sources: [],
  error: null,
  attempts: 1,
  createdAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  storage: "local",
  ...over,
});

const reader = (learnerId: string | null) =>
  vi.mocked(auth.currentUser).mockResolvedValue({
    learnerId,
    signedIn: !!learnerId,
    authSub: null,
    displayName: null,
  });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/lessons", () => {
  it("lists only the asker's jobs, and nothing for a visitor", async () => {
    reader(null);
    let res = await route.GET(get(""), ctx());
    expect(await res.json()).toEqual({ jobs: [] });
    expect(jobs.listLessonJobs).not.toHaveBeenCalled();

    reader("me");
    vi.mocked(jobs.listLessonJobs).mockResolvedValue([view()]);
    res = await route.GET(get(""), ctx());
    expect((await res.json()).jobs).toHaveLength(1);
    expect(jobs.listLessonJobs).toHaveBeenCalledWith(expect.anything(), "me");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 404 for a lesson the asker can't read, and for a bad id", async () => {
    reader("me");
    vi.mocked(jobs.getLessonJob).mockResolvedValue(null);
    expect((await route.GET(get(`/${ID}`), ctx(ID))).status).toBe(404);
    expect((await route.GET(get("/nope"), ctx("nope"))).status).toBe(404);
    reader(null);
    expect((await route.GET(get(`/${ID}`), ctx(ID))).status).toBe(404);
  });

  it("adds the stored lesson once the job is completed", async () => {
    reader("me");
    vi.mocked(jobs.getLessonJob).mockResolvedValue({
      view: view(),
      isOwner: true,
      row: {} as never,
    });
    vi.mocked(storage.getStorage).mockReturnValue({} as never);
    vi.mocked(jobs.loadLesson).mockResolvedValue({ title: "Clock maths" } as never);
    const body = await (await route.GET(get(`/${ID}`), ctx(ID))).json();
    expect(body.lesson.title).toBe("Clock maths");
    expect(jobs.getLessonJob).toHaveBeenCalledWith(expect.anything(), "me", ID);
  });
});

describe("GET /api/lessons/:id/audio/:scene", () => {
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

  it("checks access before touching storage", async () => {
    reader("someone-else");
    vi.mocked(jobs.sceneAudio).mockResolvedValue(null);
    const res = await route.GET(get(`/${ID}/audio/0`), ctx(ID, "audio", "0"));
    expect(res.status).toBe(404);
    expect(storage.getStorage).not.toHaveBeenCalled();
  });

  it("redirects to a short-lived signed URL on Vultr", async () => {
    reader("me");
    vi.mocked(jobs.sceneAudio).mockResolvedValue({ key: "k", view: view() });
    const signedGetUrl = vi.fn().mockResolvedValue("https://bucket.example/k?sig=1");
    vi.mocked(storage.getStorage).mockReturnValue({ signedGetUrl } as never);
    const res = await route.GET(get(`/${ID}/audio/0`), ctx(ID, "audio", "0"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://bucket.example/k?sig=1");
    expect(signedGetUrl).toHaveBeenCalledWith("k", 300);
  });

  it("streams local files with byte ranges", async () => {
    reader("me");
    vi.mocked(jobs.sceneAudio).mockResolvedValue({ key: "k", view: view() });
    vi.mocked(storage.getStorage).mockReturnValue({
      signedGetUrl: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(bytes),
    } as never);
    let res = await route.GET(get(`/${ID}/audio/0`), ctx(ID, "audio", "0"));
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect((await res.arrayBuffer()).byteLength).toBe(100);

    res = await route.GET(get(`/${ID}/audio/0`, { range: "bytes=10-19" }), ctx(ID, "audio", "0"));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);

    res = await route.GET(get(`/${ID}/audio/0`, { range: "bytes=500-" }), ctx(ID, "audio", "0"));
    expect(res.status).toBe(416);
  });
});

describe("POST /api/lessons", () => {
  it("refuses a change sent from another site", async () => {
    const res = await route.POST(
      post("", { topic: "Cells" }, { origin: "https://evil.example" }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("needs a signed-in student", async () => {
    vi.mocked(auth.requireUser).mockResolvedValue(
      Response.json({ error: { code: "sign_in_required" } }, { status: 401 }),
    );
    const res = await route.POST(post("", { topic: "Cells" }), ctx());
    expect(res.status).toBe(401);
    expect(jobs.enqueueLessonJob).not.toHaveBeenCalled();
  });

  it("queues a lesson for the verified learner, never an id from the body", async () => {
    vi.mocked(auth.requireUser).mockResolvedValue({
      learnerId: "me",
      signedIn: true,
      authSub: "auth0|me",
      displayName: "Me",
      sql: {} as never,
    });
    vi.mocked(jobs.enqueueLessonJob).mockResolvedValue({
      ok: true,
      status: 202,
      body: view({ status: "queued", busy: true }),
    });
    const res = await route.POST(post("", { topic: "Cell biology", ownerId: "victim" }), ctx());
    expect(res.status).toBe(202);
    expect(vi.mocked(jobs.enqueueLessonJob).mock.calls[0]![1]).toBe("me");

    expect((await route.POST(post("", { topic: "x" }), ctx())).status).toBe(400);
  });

  it("passes the queue's refusals through", async () => {
    vi.mocked(auth.requireUser).mockResolvedValue({
      learnerId: "me2",
      signedIn: true,
      authSub: "auth0|me2",
      displayName: "Me",
      sql: {} as never,
    });
    vi.mocked(jobs.retryLessonJob).mockResolvedValue({
      ok: false,
      status: 409,
      code: "conflict",
      message: "Only a lesson that failed can be retried.",
    });
    const res = await route.POST(post(`/${ID}/retry`, {}), ctx(ID, "retry"));
    expect(res.status).toBe(409);
    expect(jobs.retryLessonJob).toHaveBeenCalledWith(expect.anything(), "me2", ID);
  });
});
