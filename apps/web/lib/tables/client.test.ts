import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TABLE_IDS,
  checkClock,
  claimTable,
  dismissInvitation,
  freeStatus,
  highlightInvitation,
  holdKey,
  invitationKey,
  inviteByEmail,
  isReservable,
  mergeStatus,
  offerClaim,
  pendingInvitation,
  removeEmailInvite,
  tableName,
  useTables,
} from "./client";
import type { TableStatus, TablesView } from "./types";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 21, 15, 0);

function held(tableId: string, endsAt: number, mine = true): TableStatus {
  return {
    tableId,
    held: true,
    visibility: "private",
    holderName: "Suad",
    endsAt: new Date(endsAt).toISOString(),
    canSit: true,
    mine,
    access: mine ? "holder" : null,
    circleName: null,
  };
}

function viewWith(tables: TableStatus[]): TablesView {
  return {
    tables,
    mine: tables.find((t) => t.mine) ?? null,
    signedIn: true,
    privateAvailable: true,
    serverTime: new Date(T0).toISOString(),
  };
}

const initial = useTables.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  useTables.setState({ ...initial, offsetMs: 0 }, true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("tables in the library", () => {
  it("knows every table the seats belong to, by a friendly name", () => {
    expect(TABLE_IDS).toHaveLength(15);
    expect(isReservable("hall-t12")).toBe(true);
    expect(isReservable("gallery-desk-3")).toBe(true);
    expect(isReservable("lobby-sofa")).toBe(false);
    expect(isReservable(null)).toBe(false);
    expect(tableName("hall-t03")).toBe("Table 3");
    expect(tableName("gallery-desk-2")).toBe("Gallery desk 2");
  });

  it("merges a table's fresh status, and `mine` with it", () => {
    const view = viewWith([freeStatus("hall-t01"), freeStatus("hall-t02")]);
    const claimed = held("hall-t02", T0 + 60 * MIN);
    const after = mergeStatus(view, claimed);
    expect(after.mine).toEqual(claimed);
    expect(after.tables.find((t) => t.tableId === "hall-t02")).toEqual(claimed);
    expect(mergeStatus(after, freeStatus("hall-t02")).mine).toBeNull();
    // Someone else's table changing leaves yours alone.
    expect(mergeStatus(after, held("hall-t01", T0 + 30 * MIN, false)).mine).toEqual(claimed);
  });
});

describe("the holder's clock", () => {
  it("warns once in the last 5 minutes, then says time's up once and frees the table", () => {
    const end = T0 + 4 * MIN;
    useTables.setState({ view: viewWith([held("hall-t03", end)]) });
    checkClock(T0);
    const warning = useTables.getState().toast;
    expect(warning?.text).toMatch(/^4 minutes left at Table 3\./);
    checkClock(T0 + MIN);
    expect(useTables.getState().toast?.id).toBe(warning?.id);

    checkClock(end + 10);
    const s = useTables.getState();
    expect(s.timeUp?.tableId).toBe("hall-t03");
    expect(s.view?.mine).toBeNull();
    expect(s.view?.tables[0]).toEqual(freeStatus("hall-t03"));

    // A refresh that still lists the same hold (a clock a little out) doesn't say it twice.
    useTables.setState({ timeUp: null, view: viewWith([held("hall-t03", end)]) });
    checkClock(end + 20);
    expect(useTables.getState().timeUp).toBeNull();
  });

  it("says nothing when the hold was given up early", () => {
    const end = T0 + 50 * MIN;
    const hold = held("hall-t04", end);
    useTables.setState({ view: viewWith([hold]) });
    checkClock(T0);
    expect(useTables.getState().toast).toBeNull();
    useTables.setState({ view: mergeStatus(useTables.getState().view!, freeStatus("hall-t04")) });
    checkClock(T0 + MIN);
    expect(useTables.getState().timeUp).toBeNull();
  });

  it("shows other people's finished holds as free", () => {
    useTables.setState({ view: viewWith([held("hall-t05", T0 + MIN, false)]) });
    checkClock(T0 + 2 * MIN);
    expect(useTables.getState().view?.tables[0]?.held).toBe(false);
    expect(useTables.getState().timeUp).toBeNull();
  });

  it("keys a hold by its table and end", () => {
    expect(holdKey(held("hall-t01", T0))).toBe(`hall-t01@${new Date(T0).toISOString()}`);
  });
});

describe("the claim offer", () => {
  it("is only made while you don't hold another table", () => {
    useTables.setState({ view: viewWith([held("hall-t06", T0 + 30 * MIN)]) });
    offerClaim("hall-t07");
    expect(useTables.getState().offer).toBeNull();
    expect(useTables.getState().toast?.text).toMatch(/You're holding Table 6/);
    offerClaim("hall-t06");
    expect(useTables.getState().offer).toBe("hall-t06");

    useTables.setState({ offer: null, view: viewWith([freeStatus("hall-t07")]) });
    offerClaim("hall-t07");
    expect(useTables.getState().offer).toBe("hall-t07");
  });
});

describe("claiming", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The server answers the claim with `status`. */
  const answer = (status: TableStatus, code = 201) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(status, { status: code })),
    );

  it("asks who can join after a new private hold", async () => {
    useTables.setState({ view: viewWith([freeStatus("hall-t03")]) });
    answer(held("hall-t03", T0 + 60 * MIN));
    await claimTable("hall-t03", "private");
    expect(useTables.getState()).toMatchObject({ setup: "hall-t03", offer: null });
    expect(useTables.getState().view?.mine?.tableId).toBe("hall-t03");
  });

  it("goes by the server's answer when the table was already yours (and public)", async () => {
    const mine = { ...held("hall-t03", T0 + 20 * MIN), visibility: "public" as const };
    useTables.setState({ view: viewWith([mine]) });
    answer(mine, 200);
    await claimTable("hall-t03", "private");
    const s = useTables.getState();
    expect(s.setup).toBeNull();
    expect(s.toast?.text).toMatch(/^Table 3 is yours until/);
  });
});

describe("email invites", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds the server's masked invite to your table, and takes one back", async () => {
    useTables.setState({
      view: viewWith([{ ...held("hall-t03", T0 + 40 * MIN), emailInvites: [] }]),
    });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Response.json({ ok: true })
        : Response.json({ invite: { id: "inv-1", masked: "bi•••@gmail.com" } }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetch);
    await inviteByEmail("hall-t03", "Bilal@Gmail.com");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/tables/hall-t03/email-invites");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "Bilal@Gmail.com" });
    const invites = () => useTables.getState().view?.mine?.emailInvites;
    expect(invites()).toEqual([{ id: "inv-1", masked: "bi•••@gmail.com" }]);
    await inviteByEmail("hall-t03", "bilal@gmail.com"); // the same invite again: still one
    expect(invites()).toHaveLength(1);
    await removeEmailInvite("hall-t03", "inv-1");
    expect(fetch.mock.calls.at(-1)![0]).toBe("/api/tables/hall-t03/email-invites/inv-1");
    expect(invites()).toEqual([]);
  });

  it("shows each running invitation once, until it's put away", () => {
    const later = new Date(T0 + 30 * MIN).toISOString();
    const over = new Date(T0 - MIN).toISOString();
    const view = {
      ...viewWith([]),
      invitedTo: [
        { tableId: "hall-t02", holderName: "Ada", endsAt: over },
        { tableId: "hall-t03", holderName: "Suad", endsAt: later },
        { tableId: "hall-t04", holderName: "Cy", endsAt: later },
      ],
    };
    useTables.setState({ view });
    const first = pendingInvitation(view, useTables.getState().invitesSeen, T0);
    expect(first).toMatchObject({ tableId: "hall-t03", holderName: "Suad" });
    highlightInvitation(invitationKey(first!));
    expect(useTables.getState().highlighted).toBe(invitationKey(first!));
    dismissInvitation(invitationKey(first!));
    expect(useTables.getState().highlighted).toBeNull();
    expect(pendingInvitation(view, useTables.getState().invitesSeen, T0)?.tableId).toBe("hall-t04");
    expect(pendingInvitation({ ...viewWith([]) }, [], T0)).toBeNull(); // an older server: none
  });
});
