import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The date rule refuses a start before today (UTC), so the whole file runs on a fixed day: 1 June 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

type T = Awaited<ReturnType<typeof setup>>;
type Status = "pending" | "approved" | "pickedUp" | "returned" | "declined" | "cancelled";
const STATUSES: Status[] = ["pending", "approved", "pickedUp", "returned", "declined", "cancelled"];

/** Users 1..count have profiles. User 1 owns the tool "Drill". */
async function setup(count = 3) {
  const t = convexTest(schema);
  for (let n = 1; n <= count; n++) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  const drill = await t.run(async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(1).tokenIdentifier))
      .unique();
    return ctx.db.insert("tools", {
      ownerId: owner!._id,
      name: "Drill",
      category: "Power tools",
      condition: "Good",
      description: "Cordless",
    });
  });
  return { t, drill };
}
const as = (t: T["t"], n: number) => t.withIdentity(identity(n));
const makeAdmin = (t: T["t"], n: number) =>
  t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(n).tokenIdentifier))
      .unique();
    await ctx.db.patch(user!._id, { role: "admin" });
  });
const all = (t: T["t"]) => t.run((ctx) => ctx.db.query("requests").collect());
const request = (t: T["t"], n: number, toolId: Id<"tools">, startDate = "2026-06-10", endDate = "2026-06-12") =>
  as(t, n).mutation(api.requests.create, { toolId, startDate, endDate });
/** Inserts a request row directly (user 1 is the owner), so a test can start from any status or date. */
const seed = (t: T["t"], toolId: Id<"tools">, status: Status, borrower = 2, startDate = "2026-06-10", endDate = "2026-06-12") =>
  t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return ctx.db.insert("requests", {
      toolId,
      toolName: "Drill",
      ownerId: users[0]._id,
      borrowerId: users[borrower - 1]._id,
      startDate,
      endDate,
      status,
    });
  });
const statusOf = async (t: T["t"], id: Id<"requests">) => (await t.run((ctx) => ctx.db.get(id)))!.status;
const opts = { paginationOpts: { numItems: 10, cursor: null } };

const code = (c: string) => ({ data: { code: c } });
const NOT_SIGNED_IN = code("NOT_SIGNED_IN");
const PROFILE_MISSING = code("PROFILE_MISSING");
const FORBIDDEN = code("FORBIDDEN");
const NOT_FOUND = code("NOT_FOUND");
const NOT_PENDING = code("NOT_PENDING");
const INVALID_INPUT = code("INVALID_INPUT");
const OWN_TOOL = code("OWN_TOOL");
const START_IN_PAST = code("START_IN_PAST");
const ALREADY_REQUESTED = code("ALREADY_REQUESTED");
const ON_LOAN = code("ON_LOAN");
const RESERVED = code("RESERVED");
const NOT_CANCELLABLE = code("NOT_CANCELLABLE");
const NOT_APPROVED = code("NOT_APPROVED");
const NOT_PICKED_UP = code("NOT_PICKED_UP");
const scheduled = (t: T["t"]) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("requests.create", () => {
  test("fails without an identity or a profile, even with invalid dates", async () => {
    const { t, drill } = await setup();
    const bad = { toolId: drill, startDate: "nope", endDate: "x" };
    await expect(t.mutation(api.requests.create, bad)).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).mutation(api.requests.create, bad)).rejects.toMatchObject(PROFILE_MISSING);
    expect(await all(t)).toHaveLength(0);
  });

  test("sets borrower and owner from the caller and the tool, pending, with the tool name", async () => {
    const { t, drill } = await setup();
    await request(t, 2, drill);
    const [r] = await all(t);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    const id = (n: number) => users.find((u) => u.displayName === `User ${n}`)!._id;
    expect(r).toMatchObject({ toolId: drill, toolName: "Drill", status: "pending", startDate: "2026-06-10", endDate: "2026-06-12" });
    expect(r.borrowerId).toBe(id(2));
    expect(r.ownerId).toBe(id(1));
  });

  test("a borrower, owner or status argument is rejected", async () => {
    const { t, drill } = await setup();
    const user = (await t.run((ctx) => ctx.db.query("users").collect()))[0]._id;
    for (const extra of [{ status: "approved" }, { ownerId: user }, { borrowerId: user }])
      await expect(
        as(t, 2).mutation(api.requests.create, { toolId: drill, startDate: "2026-06-10", endDate: "2026-06-12", ...extra } as never),
      ).rejects.toThrow();
    expect(await all(t)).toHaveLength(0);
  });

  test("a missing tool is NOT_FOUND, also with invalid dates", async () => {
    const { t, drill } = await setup();
    await t.run((ctx) => ctx.db.delete(drill));
    await expect(request(t, 2, drill)).rejects.toMatchObject(NOT_FOUND);
    await expect(request(t, 2, drill, "bad", "bad")).rejects.toMatchObject(NOT_FOUND);
  });

  test("requesting your own tool is OWN_TOOL, with nothing stored or scheduled", async () => {
    const { t, drill } = await setup();
    await expect(request(t, 1, drill)).rejects.toMatchObject(OWN_TOOL);
    expect(await all(t)).toHaveLength(0);
    expect(await scheduled(t)).toHaveLength(0);
  });

  test("an admin who owns the tool is refused too", async () => {
    const { t, drill } = await setup();
    await makeAdmin(t, 1);
    await expect(request(t, 1, drill)).rejects.toMatchObject(OWN_TOOL);
    expect(await all(t)).toHaveLength(0);
  });

  test("OWN_TOOL comes before the date check, after NOT_FOUND", async () => {
    const { t, drill } = await setup();
    await expect(request(t, 1, drill, "bad", "bad")).rejects.toMatchObject(OWN_TOOL);
    await t.run((ctx) => ctx.db.delete(drill));
    await expect(request(t, 1, drill)).rejects.toMatchObject(NOT_FOUND);
  });

  test("an admin may borrow", async () => {
    const { t, drill } = await setup();
    await makeAdmin(t, 3);
    await request(t, 3, drill);
    expect(await all(t)).toHaveLength(1);
  });

  test.each([
    ["2026-6-10", "2026-06-12"],
    ["2026-06-10", "12/06/2026"],
    ["", ""],
    ["2026-06-12", "2026-06-10"],
    ["2026-02-31", "2026-03-02"],
    ["2026-06-10", "2026-13-45"],
    ["2027-02-29", "2027-03-01"],
  ])("dates %s to %s give INVALID_INPUT", async (start, end) => {
    const { t, drill } = await setup();
    await expect(request(t, 2, drill, start, end)).rejects.toMatchObject(INVALID_INPUT);
    expect(await all(t)).toHaveLength(0);
  });

  test("a leap day is a real date", async () => {
    const { t, drill } = await setup();
    await request(t, 2, drill, "2028-02-29", "2028-02-29");
    expect(await all(t)).toHaveLength(1);
  });

  test("a one-day range is valid", async () => {
    const { t, drill } = await setup();
    await request(t, 2, drill, "2026-06-10", "2026-06-10");
    expect(await all(t)).toHaveLength(1);
  });

  test("a start before today (UTC) is START_IN_PAST, with nothing stored or scheduled", async () => {
    const { t, drill } = await setup();
    await expect(request(t, 2, drill, "2026-05-31", "2026-06-02")).rejects.toMatchObject(START_IN_PAST);
    expect(await all(t)).toHaveLength(0);
    expect(await scheduled(t)).toHaveLength(0);
  });

  test("a start today is accepted", async () => {
    const { t, drill } = await setup();
    await request(t, 2, drill, "2026-06-01", "2026-06-01");
    expect(await all(t)).toHaveLength(1);
  });

  test("malformed dates are INVALID_INPUT before START_IN_PAST", async () => {
    const { t, drill } = await setup();
    await expect(request(t, 2, drill, "2026-05-31", "2026-05-30")).rejects.toMatchObject(INVALID_INPUT);
  });

  test.each(["pending", "approved"] as const)("a second request on the same tool while yours is %s is ALREADY_REQUESTED", async (status) => {
    const { t, drill } = await setup();
    await seed(t, drill, status);
    await expect(request(t, 2, drill)).rejects.toMatchObject(ALREADY_REQUESTED);
    expect(await all(t)).toHaveLength(1);
    expect(await scheduled(t)).toHaveLength(0);
  });

  test.each(["returned", "declined", "cancelled"] as const)("a new request is allowed once the earlier one is %s", async (status) => {
    const { t, drill } = await setup();
    await seed(t, drill, status);
    await request(t, 2, drill);
    expect(await all(t)).toHaveLength(2);
  });

  test("another borrower's request, or the same borrower on another tool, is not a duplicate", async () => {
    const { t, drill } = await setup();
    await seed(t, drill, "pending", 2);
    await request(t, 3, drill);
    const saw = await t.run(async (ctx) => {
      const [owner] = await ctx.db.query("users").collect();
      return ctx.db.insert("tools", { ownerId: owner._id, name: "Saw", category: "Hand tools", condition: "Good", description: "x" });
    });
    await request(t, 2, saw);
    expect(await all(t)).toHaveLength(3);
  });

  test("a tool that is on loan is ON_LOAN, also for the borrower who holds it", async () => {
    const { t, drill } = await setup();
    await seed(t, drill, "pickedUp", 2);
    await expect(request(t, 3, drill)).rejects.toMatchObject(ON_LOAN);
    await expect(request(t, 2, drill)).rejects.toMatchObject(ON_LOAN);
    expect(await all(t)).toHaveLength(1);
    expect(await scheduled(t)).toHaveLength(0);
  });

  test("a reserved tool still takes requests", async () => {
    const { t, drill } = await setup();
    await seed(t, drill, "approved", 2);
    await request(t, 3, drill);
    expect(await all(t)).toHaveLength(2);
  });

  test("check order: START_IN_PAST, then ALREADY_REQUESTED, then ON_LOAN", async () => {
    const { t, drill } = await setup(4);
    await seed(t, drill, "pending", 3);
    await seed(t, drill, "pickedUp", 2);
    // user 3 has a pending request on a tool someone else holds
    await expect(request(t, 3, drill)).rejects.toMatchObject(ALREADY_REQUESTED);
    // a past start wins over both
    await expect(request(t, 3, drill, "2026-05-31", "2026-06-02")).rejects.toMatchObject(START_IN_PAST);
    // a user with nothing open gets ON_LOAN
    await expect(request(t, 4, drill)).rejects.toMatchObject(ON_LOAN);
  });
});

describe("requests.decide", () => {
  const pending = async (users = 3) => {
    const s = await setup(users);
    await request(s.t, 2, s.drill);
    const [r] = await all(s.t);
    return { ...s, id: r._id };
  };
  const decide = (t: T["t"], n: number, id: Id<"requests">, decision: "approve" | "decline") =>
    as(t, n).mutation(api.requests.decide, { id, decision });

  test("fails without an identity or a profile", async () => {
    const { t, id } = await pending();
    await expect(t.mutation(api.requests.decide, { id, decision: "approve" })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(
      t.withIdentity(identity(99)).mutation(api.requests.decide, { id, decision: "approve" }),
    ).rejects.toMatchObject(PROFILE_MISSING);
  });

  test("the owner approves and declines", async () => {
    const { t, id } = await pending();
    await decide(t, 1, id, "approve");
    expect((await all(t))[0].status).toBe("approved");
    const second = await pending();
    await decide(second.t, 1, second.id, "decline");
    expect((await all(second.t))[0].status).toBe("declined");
  });

  test("an admin who is not the owner, the borrower and a plain stranger are FORBIDDEN", async () => {
    const { t, id } = await pending(4);
    await makeAdmin(t, 3);
    for (const n of [3, 2, 4]) await expect(decide(t, n, id, "approve")).rejects.toMatchObject(FORBIDDEN);
    expect((await all(t))[0].status).toBe("pending");
  });

  test("a decision outside approve and decline is rejected", async () => {
    const { t, id } = await pending();
    await expect(as(t, 1).mutation(api.requests.decide, { id, decision: "returned" } as never)).rejects.toThrow();
    expect((await all(t))[0].status).toBe("pending");
  });

  test("an already decided request is NOT_PENDING and unchanged", async () => {
    const { t, id } = await pending();
    await decide(t, 1, id, "decline");
    await expect(decide(t, 1, id, "approve")).rejects.toMatchObject(NOT_PENDING);
    expect((await all(t))[0].status).toBe("declined");
  });

  test("a deleted request is NOT_FOUND", async () => {
    const { t, id } = await pending();
    await t.run((ctx) => ctx.db.delete(id));
    await expect(decide(t, 1, id, "approve")).rejects.toMatchObject(NOT_FOUND);
  });

  test("approving while another request is reserved is RESERVED and leaves the request pending", async () => {
    const { t, drill, id } = await pending(4);
    await seed(t, drill, "approved", 3);
    await expect(decide(t, 1, id, "approve")).rejects.toMatchObject(RESERVED);
    expect(await statusOf(t, id)).toBe("pending");
  });

  test("approving while the tool is on loan is ON_LOAN and leaves the request pending", async () => {
    const { t, drill, id } = await pending(4);
    await seed(t, drill, "pickedUp", 3);
    await expect(decide(t, 1, id, "approve")).rejects.toMatchObject(ON_LOAN);
    expect(await statusOf(t, id)).toBe("pending");
  });

  test("ON_LOAN wins when a tool is both reserved and on loan (old data)", async () => {
    const { t, drill, id } = await pending(4);
    await seed(t, drill, "approved", 3);
    await seed(t, drill, "pickedUp", 4);
    await expect(decide(t, 1, id, "approve")).rejects.toMatchObject(ON_LOAN);
  });

  test("declining is still allowed while the tool is reserved or on loan", async () => {
    const { t, drill, id } = await pending(4);
    await seed(t, drill, "pickedUp", 3);
    await decide(t, 1, id, "decline");
    expect(await statusOf(t, id)).toBe("declined");
  });

  test("approving is allowed again once the reservation is cancelled or the loan returned", async () => {
    const { t, drill, id } = await pending(4);
    const reserved = await seed(t, drill, "approved", 3);
    await as(t, 1).mutation(api.requests.cancel, { id: reserved });
    await decide(t, 1, id, "approve");
    expect(await statusOf(t, id)).toBe("approved");

    const other = await pending(4);
    const loan = await seed(other.t, other.drill, "pickedUp", 3);
    await as(other.t, 1).mutation(api.requests.markReturned, { id: loan });
    await decide(other.t, 1, other.id, "approve");
    expect(await statusOf(other.t, other.id)).toBe("approved");
  });

  test("a stranger approving a reserved tool's request is FORBIDDEN, not RESERVED", async () => {
    const { t, drill, id } = await pending(4);
    await seed(t, drill, "approved", 3);
    await expect(decide(t, 4, id, "approve")).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("requests.cancel", () => {
  const open = async (status: Status) => {
    const s = await setup(4);
    return { ...s, id: await seed(s.t, s.drill, status) };
  };
  const cancel = (t: T["t"], n: number, id: Id<"requests">) => as(t, n).mutation(api.requests.cancel, { id });

  test("fails without an identity or a profile", async () => {
    const { t, id } = await open("approved");
    await expect(t.mutation(api.requests.cancel, { id })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).mutation(api.requests.cancel, { id })).rejects.toMatchObject(PROFILE_MISSING);
    expect(await statusOf(t, id)).toBe("approved");
  });

  test.each(["pending", "approved"] as const)("the borrower cancels their %s request", async (status) => {
    const { t, id } = await open(status);
    await cancel(t, 2, id);
    expect(await statusOf(t, id)).toBe("cancelled");
  });

  test("the owner cancels an approved request, also when the owner is an admin", async () => {
    const { t, id } = await open("approved");
    await cancel(t, 1, id);
    expect(await statusOf(t, id)).toBe("cancelled");
    const admin = await open("approved");
    await makeAdmin(admin.t, 1);
    await cancel(admin.t, 1, admin.id);
    expect(await statusOf(admin.t, admin.id)).toBe("cancelled");
  });

  test("the owner cannot cancel a pending request (FORBIDDEN: the owner declines)", async () => {
    const { t, id } = await open("pending");
    await expect(cancel(t, 1, id)).rejects.toMatchObject(FORBIDDEN);
    expect(await statusOf(t, id)).toBe("pending");
  });

  test.each(["pickedUp", "returned", "declined", "cancelled"] as const)("a %s request is NOT_CANCELLABLE for the borrower and the owner", async (status) => {
    const { t, id } = await open(status);
    for (const n of [1, 2]) await expect(cancel(t, n, id)).rejects.toMatchObject(NOT_CANCELLABLE);
    expect(await statusOf(t, id)).toBe(status);
  });

  test.each(STATUSES)("a stranger and an admin who is neither are FORBIDDEN on a %s request, never a status hint", async (status) => {
    const { t, id } = await open(status);
    await makeAdmin(t, 3);
    for (const n of [3, 4]) await expect(cancel(t, n, id)).rejects.toMatchObject(FORBIDDEN);
    expect(await statusOf(t, id)).toBe(status);
  });

  test("a deleted request is NOT_FOUND", async () => {
    const { t, id } = await open("approved");
    await t.run((ctx) => ctx.db.delete(id));
    await expect(cancel(t, 1, id)).rejects.toMatchObject(NOT_FOUND);
  });

  test("anything besides the id is rejected", async () => {
    const { t, id } = await open("approved");
    await expect(as(t, 2).mutation(api.requests.cancel, { id, status: "returned" } as never)).rejects.toThrow();
    expect(await statusOf(t, id)).toBe("approved");
  });
});

describe("requests.confirmPickup", () => {
  const open = async (status: Status) => {
    const s = await setup(4);
    return { ...s, id: await seed(s.t, s.drill, status) };
  };
  const pickup = (t: T["t"], n: number, id: Id<"requests">) => as(t, n).mutation(api.requests.confirmPickup, { id });

  test("fails without an identity or a profile", async () => {
    const { t, id } = await open("approved");
    await expect(t.mutation(api.requests.confirmPickup, { id })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).mutation(api.requests.confirmPickup, { id })).rejects.toMatchObject(PROFILE_MISSING);
    expect(await statusOf(t, id)).toBe("approved");
  });

  test("the borrower confirms an approved request, and other pending requests stay pending", async () => {
    const { t, drill, id } = await open("approved");
    await request(t, 3, drill);
    await pickup(t, 2, id);
    expect(await statusOf(t, id)).toBe("pickedUp");
    expect((await all(t)).map((r) => r.status).sort()).toEqual(["pending", "pickedUp"]);
  });

  test("the owner, an admin who is neither and a stranger are FORBIDDEN", async () => {
    const { t, id } = await open("approved");
    await makeAdmin(t, 3);
    for (const n of [1, 3, 4]) await expect(pickup(t, n, id)).rejects.toMatchObject(FORBIDDEN);
    expect(await statusOf(t, id)).toBe("approved");
  });

  test.each(["pending", "pickedUp", "returned", "declined", "cancelled"] as const)("the borrower on a %s request gets NOT_APPROVED", async (status) => {
    const { t, id } = await open(status);
    await expect(pickup(t, 2, id)).rejects.toMatchObject(NOT_APPROVED);
    expect(await statusOf(t, id)).toBe(status);
  });

  test("a non-borrower on a non-approved request is FORBIDDEN, not NOT_APPROVED", async () => {
    const { t, id } = await open("pending");
    for (const n of [1, 4]) await expect(pickup(t, n, id)).rejects.toMatchObject(FORBIDDEN);
  });

  test("a deleted request is NOT_FOUND", async () => {
    const { t, id } = await open("approved");
    await t.run((ctx) => ctx.db.delete(id));
    await expect(pickup(t, 2, id)).rejects.toMatchObject(NOT_FOUND);
  });

  test("anything besides the id is rejected", async () => {
    const { t, id } = await open("approved");
    await expect(as(t, 2).mutation(api.requests.confirmPickup, { id, status: "returned" } as never)).rejects.toThrow();
    expect(await statusOf(t, id)).toBe("approved");
  });

  test("no date check: a borrower may confirm before the start date", async () => {
    const s = await setup(3);
    const id = await seed(s.t, s.drill, "approved", 2, "2026-07-01", "2026-07-03");
    await pickup(s.t, 2, id);
    expect(await statusOf(s.t, id)).toBe("pickedUp");
  });
});

describe("request lists", () => {
  const lists = async () => {
    const s = await setup(4);
    const other = await s.t.run(async (ctx) => {
      const owner = await ctx.db.query("users").collect();
      return ctx.db.insert("tools", {
        ownerId: owner.find((u) => u.displayName === "User 3")!._id,
        name: "Saw",
        category: "Hand tools",
        condition: "Good",
        description: "x",
      });
    });
    await request(s.t, 2, s.drill, "2026-06-10", "2026-06-11"); // user 2 borrows from user 1
    await request(s.t, 2, other, "2026-07-01", "2026-07-02"); // user 2 borrows from user 3
    await request(s.t, 4, s.drill, "2026-08-01", "2026-08-02"); // user 4 borrows from user 1
    return s;
  };

  test("both fail without an identity or a profile", async () => {
    const { t } = await lists();
    for (const fn of [api.requests.listMine, api.requests.listIncoming]) {
      await expect(t.query(fn, opts)).rejects.toMatchObject(NOT_SIGNED_IN);
      await expect(t.withIdentity(identity(99)).query(fn, opts)).rejects.toMatchObject(PROFILE_MISSING);
    }
  });

  test("listMine returns only the caller's requests, newest first, with exact keys", async () => {
    const { t } = await lists();
    const res = await as(t, 2).query(api.requests.listMine, opts);
    expect(res.page.map((r) => r.toolName)).toEqual(["Saw", "Drill"]);
    for (const r of res.page) expect(Object.keys(r).sort()).toEqual(["_id", "endDate", "startDate", "status", "toolName"]);
    expect((await as(t, 1).query(api.requests.listMine, opts)).page).toEqual([]);
  });

  test("listIncoming returns only requests for the caller's tools with the borrower's name", async () => {
    const { t } = await lists();
    const res = await as(t, 1).query(api.requests.listIncoming, opts);
    expect(res.page.map((r) => r.borrowerName)).toEqual(["User 4", "User 2"]);
    for (const r of res.page)
      expect(Object.keys(r).sort()).toEqual(["_id", "blocked", "borrowerName", "endDate", "startDate", "status", "toolName"]);
    expect((await as(t, 2).query(api.requests.listIncoming, opts)).page).toEqual([]);
  });

  test("an admin sees only their own requests", async () => {
    const { t } = await lists();
    await makeAdmin(t, 3);
    const res = await as(t, 3).query(api.requests.listIncoming, opts);
    expect(res.page.map((r) => r.toolName)).toEqual(["Saw"]);
    expect((await as(t, 3).query(api.requests.listMine, opts)).page).toEqual([]);
  });

  test("a request still lists after its tool is deleted", async () => {
    const { t, drill } = await lists();
    await t.run((ctx) => ctx.db.delete(drill));
    const res = await as(t, 1).query(api.requests.listIncoming, opts);
    expect(res.page.map((r) => r.toolName)).toEqual(["Drill", "Drill"]);
  });

  describe("listIncoming blocked", () => {
    const blocked = async (t: T["t"]) => (await as(t, 1).query(api.requests.listIncoming, opts)).page.map((r) => [r.status, r.blocked]);

    test("is null for a pending request on a free tool", async () => {
      const { t, drill } = await setup(3);
      await request(t, 2, drill);
      expect(await blocked(t)).toEqual([["pending", null]]);
    });

    test("is reserved for a pending request while another request on the tool is reserved", async () => {
      const { t, drill } = await setup(3);
      await seed(t, drill, "approved", 3);
      await request(t, 2, drill);
      expect(await blocked(t)).toEqual([["pending", "reserved"], ["approved", null]]);
    });

    test("is onLoan while the tool is on loan, and onLoan wins over reserved", async () => {
      const { t, drill } = await setup(4);
      await seed(t, drill, "pickedUp", 3);
      await seed(t, drill, "pending", 2); // a request sent before the pickup; creating one now is refused
      expect(await blocked(t)).toEqual([["pending", "onLoan"], ["pickedUp", null]]);
      await seed(t, drill, "approved", 4);
      expect((await blocked(t))[0]).toEqual(["approved", null]);
      expect((await blocked(t))[1]).toEqual(["pending", "onLoan"]);
    });

    test("is null for requests that are not pending", async () => {
      const { t, drill } = await setup(3);
      for (const status of ["returned", "declined", "cancelled"] as const) await seed(t, drill, status);
      expect((await blocked(t)).every(([, b]) => b === null)).toBe(true);
    });
  });
});

describe("tools.listAll availability and requested", () => {
  const listed = async (t: T["t"], n = 3) => (await as(t, n).query(api.tools.listAll, opts)).page[0];

  test("available when there is no request", async () => {
    const { t } = await setup();
    expect((await listed(t)).availability).toBe("available");
  });

  test.each([
    ["approved", "reserved"],
    ["pickedUp", "onLoan"],
    ["pending", "available"],
    ["declined", "available"],
    ["returned", "available"],
    ["cancelled", "available"],
  ] as const)("a %s request makes the tool %s, whatever its dates", async (status, expected) => {
    for (const [start, end] of [["2026-01-01", "2026-01-05"], ["2026-06-01", "2026-06-02"], ["2026-12-01", "2026-12-05"]]) {
      const { t, drill } = await setup();
      await seed(t, drill, status, 2, start, end);
      expect((await listed(t)).availability).toBe(expected);
    }
  });

  test("on loan wins when a tool has both a reserved and a picked-up request", async () => {
    const { t, drill } = await setup(4);
    await seed(t, drill, "approved", 3);
    await seed(t, drill, "pickedUp", 4);
    expect((await listed(t)).availability).toBe("onLoan");
  });

  test("returning the loan makes the tool available again", async () => {
    const { t, drill } = await setup();
    const id = await seed(t, drill, "pickedUp");
    expect((await listed(t)).availability).toBe("onLoan");
    await as(t, 1).mutation(api.requests.markReturned, { id });
    expect((await listed(t)).availability).toBe("available");
  });

  test("requested is true for the caller's own pending or approved request only", async () => {
    for (const status of ["pending", "approved"] as const) {
      const { t, drill } = await setup();
      await seed(t, drill, status, 2);
      expect((await listed(t, 2)).requested).toBe(true);
      expect((await listed(t, 3)).requested).toBe(false); // someone else's request
      expect((await listed(t, 1)).requested).toBe(false); // the owner
    }
  });

  test.each(["pickedUp", "returned", "declined", "cancelled"] as const)("requested is false for a %s request", async (status) => {
    const { t, drill } = await setup();
    await seed(t, drill, status, 2);
    expect((await listed(t, 2)).requested).toBe(false);
  });

  test("requested turns false again after the request is cancelled", async () => {
    const { t, drill } = await setup();
    const id = await seed(t, drill, "pending", 2);
    expect((await listed(t, 2)).requested).toBe(true);
    await as(t, 2).mutation(api.requests.cancel, { id });
    expect((await listed(t, 2)).requested).toBe(false);
  });

  test("the public list hides tools that are on loan and shows the rest, with name and category only", async () => {
    const { t, drill } = await setup();
    await as(t, 1).mutation(api.tools.create, { name: "Saw", category: "Hand tools", condition: "Good", description: "x" });
    await seed(t, drill, "pickedUp");
    const res = await t.query(api.tools.listPublic, opts);
    expect(res.page).toEqual([{ name: "Saw", category: "Hand tools" }]);
  });

  test.each(["pending", "approved", "declined", "returned", "cancelled"] as const)("the public list still shows a tool whose request is %s", async (status) => {
    const { t, drill } = await setup();
    await seed(t, drill, status);
    expect((await t.query(api.tools.listPublic, opts)).page).toEqual([{ name: "Drill", category: "Power tools" }]);
  });
});

describe("requests.markReturned", () => {
  /** User 2 borrows user 1's Drill; the request is picked up by default. */
  const loan = async (status: Status = "pickedUp", start = "2026-06-10", end = "2026-06-12") => {
    const s = await setup(4);
    await request(s.t, 2, s.drill, start, end);
    const [r] = await all(s.t);
    await s.t.run((ctx) => ctx.db.patch(r._id, { status }));
    return { ...s, id: r._id };
  };
  const mark = (t: T["t"], n: number, id: Id<"requests">) => as(t, n).mutation(api.requests.markReturned, { id });

  test("fails without an identity or a profile", async () => {
    const { t, id } = await loan();
    await expect(t.mutation(api.requests.markReturned, { id })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).mutation(api.requests.markReturned, { id })).rejects.toMatchObject(PROFILE_MISSING);
    expect((await all(t))[0].status).toBe("pickedUp");
  });

  test("the owner marks a picked-up loan returned and the tool is no longer on loan", async () => {
    const { t, id } = await loan();
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].availability).toBe("onLoan");
    await mark(t, 1, id);
    expect((await all(t))[0].status).toBe("returned");
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].availability).toBe("available");
  });

  test("the borrower, an admin who is not the owner and a stranger are FORBIDDEN", async () => {
    const { t, id } = await loan();
    await makeAdmin(t, 3);
    for (const n of [2, 3, 4]) await expect(mark(t, n, id)).rejects.toMatchObject(FORBIDDEN);
    expect((await all(t))[0].status).toBe("pickedUp");
  });

  test.each(["approved", "pending", "declined", "cancelled", "returned"] as const)("a %s request is NOT_PICKED_UP and unchanged", async (status) => {
    const { t, id } = await loan(status);
    await expect(mark(t, 1, id)).rejects.toMatchObject(NOT_PICKED_UP);
    expect((await all(t))[0].status).toBe(status);
  });

  test("a picked-up loan can be returned whatever its dates, before it starts or after it ends", async () => {
    const early = await loan("pickedUp", "2026-06-12", "2026-06-14");
    await mark(early.t, 1, early.id);
    expect((await all(early.t))[0].status).toBe("returned");
    const late = await setup(3);
    const id = await seed(late.t, late.drill, "pickedUp", 2, "2026-05-01", "2026-05-05"); // started before the pinned day
    await mark(late.t, 1, id);
    expect(await statusOf(late.t, id)).toBe("returned");
  });

  test("a deleted request is NOT_FOUND", async () => {
    const { t, id } = await loan();
    await t.run((ctx) => ctx.db.delete(id));
    await expect(mark(t, 1, id)).rejects.toMatchObject(NOT_FOUND);
  });

  test("anything besides the id is rejected", async () => {
    const { t, id } = await loan();
    await expect(as(t, 1).mutation(api.requests.markReturned, { id, status: "returned" } as never)).rejects.toThrow();
  });

  test("an owner who is also an admin can mark their own loan returned", async () => {
    const { t, id } = await loan();
    await makeAdmin(t, 1);
    await mark(t, 1, id);
    expect((await all(t))[0].status).toBe("returned");
  });

  test("a stranger gets FORBIDDEN before NOT_PICKED_UP", async () => {
    const { t, id } = await loan("approved", "2026-07-01", "2026-07-02");
    await expect(mark(t, 4, id)).rejects.toMatchObject(FORBIDDEN);
    await t.run((ctx) => ctx.db.patch(id, { status: "pending" }));
    await expect(mark(t, 4, id)).rejects.toMatchObject(FORBIDDEN);
  });

  test("the tool stays on loan while another picked-up request exists (old data)", async () => {
    const { t, drill, id } = await loan();
    await seed(t, drill, "pickedUp", 3);
    await mark(t, 1, id);
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].availability).toBe("onLoan");
  });
});
