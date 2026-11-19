import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

type T = Awaited<ReturnType<typeof setup>>;

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
const opts = { paginationOpts: { numItems: 10, cursor: null } };

const NOT_SIGNED_IN = { data: { code: "NOT_SIGNED_IN" } };
const PROFILE_MISSING = { data: { code: "PROFILE_MISSING" } };
const FORBIDDEN = { data: { code: "FORBIDDEN" } };
const NOT_FOUND = { data: { code: "NOT_FOUND" } };
const NOT_PENDING = { data: { code: "NOT_PENDING" } };
const INVALID_INPUT = { data: { code: "INVALID_INPUT" } };

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
});

describe("requests.decide", () => {
  const pending = async (users = 3) => {
    const s = await setup(users);
    await request(s.t, 2, s.drill);
    const [r] = await all(s.t);
    return { ...s, id: r._id };
  };

  test("fails without an identity or a profile", async () => {
    const { t, id } = await pending();
    await expect(t.mutation(api.requests.decide, { id, decision: "approve" })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(
      t.withIdentity(identity(99)).mutation(api.requests.decide, { id, decision: "approve" }),
    ).rejects.toMatchObject(PROFILE_MISSING);
  });

  test("the owner approves and declines", async () => {
    const { t, id } = await pending();
    await as(t, 1).mutation(api.requests.decide, { id, decision: "approve" });
    expect((await all(t))[0].status).toBe("approved");
    const second = await pending();
    await as(second.t, 1).mutation(api.requests.decide, { id: second.id, decision: "decline" });
    expect((await all(second.t))[0].status).toBe("declined");
  });

  test("an admin who is not the owner, the borrower and a plain stranger are FORBIDDEN", async () => {
    const { t, id } = await pending(4);
    await makeAdmin(t, 3);
    for (const n of [3, 2, 4]) await expect(as(t, n).mutation(api.requests.decide, { id, decision: "approve" })).rejects.toMatchObject(FORBIDDEN);
    expect((await all(t))[0].status).toBe("pending");
  });

  test("a decision outside approve and decline is rejected", async () => {
    const { t, id } = await pending();
    await expect(as(t, 1).mutation(api.requests.decide, { id, decision: "returned" } as never)).rejects.toThrow();
    expect((await all(t))[0].status).toBe("pending");
  });

  test("an already decided request is NOT_PENDING and unchanged", async () => {
    const { t, id } = await pending();
    await as(t, 1).mutation(api.requests.decide, { id, decision: "decline" });
    await expect(as(t, 1).mutation(api.requests.decide, { id, decision: "approve" })).rejects.toMatchObject(NOT_PENDING);
    expect((await all(t))[0].status).toBe("declined");
  });

  test("a deleted request is NOT_FOUND", async () => {
    const { t, id } = await pending();
    await t.run((ctx) => ctx.db.delete(id));
    await expect(as(t, 1).mutation(api.requests.decide, { id, decision: "approve" })).rejects.toMatchObject(NOT_FOUND);
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
      expect(Object.keys(r).sort()).toEqual(["_id", "borrowerName", "endDate", "startDate", "status", "toolName"]);
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
});

describe("tools.listAll onLoan", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const onLoan = async (t: T["t"]) => (await as(t, 3).query(api.tools.listAll, opts)).page[0].onLoan;
  const seedRequest = (t: T["t"], drill: Id<"tools">, status: "pending" | "approved" | "declined", startDate: string, endDate: string) =>
    t.run(async (ctx) => {
      const [u1, u2] = await ctx.db.query("users").collect();
      await ctx.db.insert("requests", { toolId: drill, toolName: "Drill", ownerId: u1._id, borrowerId: u2._id, startDate, endDate, status });
    });

  test("false when there is no request", async () => {
    const { t } = await setup();
    expect(await onLoan(t)).toBe(false);
  });

  test.each([
    ["2026-06-11", "2026-06-15"], // first day
    ["2026-06-09", "2026-06-13"], // middle
    ["2026-06-08", "2026-06-11"], // last day
  ])("true for an approved request %s to %s", async (start, end) => {
    const { t, drill } = await setup();
    await seedRequest(t, drill, "approved", start, end);
    expect(await onLoan(t)).toBe(true);
  });

  test.each([
    ["pending", "2026-06-09", "2026-06-13"],
    ["declined", "2026-06-09", "2026-06-13"],
    ["approved", "2026-06-01", "2026-06-10"], // past
    ["approved", "2026-06-12", "2026-06-15"], // future
  ] as const)("false for a %s request %s to %s", async (status, start, end) => {
    const { t, drill } = await setup();
    await seedRequest(t, drill, status, start, end);
    expect(await onLoan(t)).toBe(false);
  });

  test("the public list hides tools that are on loan today and shows the rest", async () => {
    const { t, drill } = await setup();
    await as(t, 1).mutation(api.tools.create, { name: "Saw", category: "Hand tools", condition: "Good", description: "x" });
    await seedRequest(t, drill, "approved", "2026-06-10", "2026-06-12");
    const res = await t.query(api.tools.listPublic, opts);
    expect(res.page).toEqual([{ name: "Saw", category: "Hand tools" }]);
  });

  test("the public list still shows a tool whose request is pending, declined or not today", async () => {
    const { t, drill } = await setup();
    await seedRequest(t, drill, "pending", "2026-06-10", "2026-06-12");
    await seedRequest(t, drill, "approved", "2026-06-20", "2026-06-22");
    expect((await t.query(api.tools.listPublic, opts)).page).toEqual([{ name: "Drill", category: "Power tools" }]);
  });

  test("true when an older approved loan and a current one both exist", async () => {
    const { t, drill } = await setup();
    await seedRequest(t, drill, "approved", "2026-01-01", "2026-01-05");
    await seedRequest(t, drill, "approved", "2026-06-10", "2026-06-12");
    expect(await onLoan(t)).toBe(true);
  });
});

describe("requests.markReturned", () => {
  const NOT_APPROVED = { data: { code: "NOT_APPROVED" } };
  const NOT_STARTED = { data: { code: "NOT_STARTED" } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  /** User 2 borrows user 1's Drill; the request is approved by default. */
  const loan = async (status: "pending" | "approved" | "declined" | "returned" = "approved", start = "2026-06-10", end = "2026-06-12") => {
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
    expect((await all(t))[0].status).toBe("approved");
  });

  test("the owner marks an approved loan returned and the tool is no longer on loan", async () => {
    const { t, id } = await loan();
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].onLoan).toBe(true);
    await mark(t, 1, id);
    expect((await all(t))[0].status).toBe("returned");
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].onLoan).toBe(false);
  });

  test("the borrower, an admin who is not the owner and a stranger are FORBIDDEN", async () => {
    const { t, id } = await loan();
    await makeAdmin(t, 3);
    for (const n of [2, 3, 4]) await expect(mark(t, n, id)).rejects.toMatchObject(FORBIDDEN);
    expect((await all(t))[0].status).toBe("approved");
  });

  test.each(["pending", "declined", "returned"] as const)("a %s request is NOT_APPROVED and unchanged", async (status) => {
    const { t, id } = await loan(status);
    await expect(mark(t, 1, id)).rejects.toMatchObject(NOT_APPROVED);
    expect((await all(t))[0].status).toBe(status);
  });

  test("a loan that has not started is NOT_STARTED and stays approved", async () => {
    const { t, id } = await loan("approved", "2026-06-12", "2026-06-14");
    await expect(mark(t, 1, id)).rejects.toMatchObject(NOT_STARTED);
    expect((await all(t))[0].status).toBe("approved");
  });

  test("a loan that starts today can be marked returned", async () => {
    const { t, id } = await loan("approved", "2026-06-11", "2026-06-14");
    await mark(t, 1, id);
    expect((await all(t))[0].status).toBe("returned");
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
});

describe("requests.markReturned edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const approved = async (start: string, end: string) => {
    const s = await setup(4);
    await request(s.t, 2, s.drill, start, end);
    const [r] = await all(s.t);
    await s.t.run((ctx) => ctx.db.patch(r._id, { status: "approved" }));
    return { ...s, id: r._id };
  };

  test("an overdue loan can be marked returned", async () => {
    const { t, id } = await approved("2026-05-01", "2026-05-05");
    await as(t, 1).mutation(api.requests.markReturned, { id });
    expect((await all(t))[0].status).toBe("returned");
  });

  test("an owner who is also an admin can mark their own loan returned", async () => {
    const { t, id } = await approved("2026-06-10", "2026-06-12");
    await makeAdmin(t, 1);
    await as(t, 1).mutation(api.requests.markReturned, { id });
    expect((await all(t))[0].status).toBe("returned");
  });

  test("a stranger gets FORBIDDEN before NOT_APPROVED or NOT_STARTED", async () => {
    const { t, id } = await approved("2026-07-01", "2026-07-02");
    await expect(as(t, 4).mutation(api.requests.markReturned, { id })).rejects.toMatchObject(FORBIDDEN);
    await t.run((ctx) => ctx.db.patch(id, { status: "pending" }));
    await expect(as(t, 4).mutation(api.requests.markReturned, { id })).rejects.toMatchObject(FORBIDDEN);
  });

  test("the tool stays on loan while another approved request includes today", async () => {
    const { t, drill, id } = await approved("2026-06-10", "2026-06-12");
    await t.run(async (ctx) => {
      const [u1, u2] = await ctx.db.query("users").collect();
      await ctx.db.insert("requests", { toolId: drill, toolName: "Drill", ownerId: u1._id, borrowerId: u2._id, startDate: "2026-06-09", endDate: "2026-06-13", status: "approved" });
    });
    await as(t, 1).mutation(api.requests.markReturned, { id });
    expect((await as(t, 3).query(api.tools.listAll, opts)).page[0].onLoan).toBe(true);
  });
});
