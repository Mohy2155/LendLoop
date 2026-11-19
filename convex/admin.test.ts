import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

type T = Awaited<ReturnType<typeof setup>>["t"];

/** Users 1..4 have profiles; user 4 is an admin. User 1 owns "Drill"; user 2 borrows it. */
async function setup() {
  const t = convexTest(schema);
  for (let n = 1; n <= 4; n++) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  const ids = await t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const id = (n: number) => users.find((u) => u.displayName === `User ${n}`)!._id;
    await ctx.db.patch(id(4), { role: "admin" });
    const drill = await ctx.db.insert("tools", {
      ownerId: id(1),
      name: "Drill",
      category: "Power tools",
      condition: "Good",
      description: "Cordless",
    });
    return { u: [0, id(1), id(2), id(3), id(4)] as Id<"users">[], drill };
  });
  return { t, ...ids };
}
const as = (t: T, n: number) => t.withIdentity(identity(n));
const opts = { paginationOpts: { numItems: 10, cursor: null } };
const seed = (t: T, toolId: Id<"tools">, ownerId: Id<"users">, borrowerId: Id<"users">, status: "pending" | "approved" | "declined" | "returned") =>
  t.run((ctx) =>
    ctx.db.insert("requests", { toolId, toolName: "Drill", ownerId, borrowerId, startDate: "2026-06-10", endDate: "2026-06-12", status }),
  );

const NOT_SIGNED_IN = { data: { code: "NOT_SIGNED_IN" } };
const PROFILE_MISSING = { data: { code: "PROFILE_MISSING" } };
const FORBIDDEN = { data: { code: "FORBIDDEN" } };
const NOT_FOUND = { data: { code: "NOT_FOUND" } };

describe("tools.removeAny", () => {
  test("fails without an identity or a profile", async () => {
    const { t, drill } = await setup();
    await expect(t.mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(PROFILE_MISSING);
  });

  test("an admin removes another user's tool, including one with requests", async () => {
    const { t, u, drill } = await setup();
    await seed(t, drill, u[1], u[2], "approved");
    await as(t, 4).mutation(api.tools.removeAny, { id: drill });
    expect(await t.run((ctx) => ctx.db.get(drill))).toBeNull();
    const [request] = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(request.toolName).toBe("Drill");
  });

  test("a regular user is FORBIDDEN, even on their own tool", async () => {
    const { t, drill } = await setup();
    await expect(as(t, 1).mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(FORBIDDEN);
    await expect(as(t, 2).mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(FORBIDDEN);
    expect(await t.run((ctx) => ctx.db.get(drill))).not.toBeNull();
  });

  test("a missing tool is NOT_FOUND", async () => {
    const { t, drill } = await setup();
    await t.run((ctx) => ctx.db.delete(drill));
    await expect(as(t, 4).mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(NOT_FOUND);
    await expect(as(t, 1).mutation(api.tools.removeAny, { id: drill })).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("admin.listLoans", () => {
  test("fails without an identity or a profile, and for a regular user", async () => {
    const { t } = await setup();
    await expect(t.query(api.admin.listLoans, opts)).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).query(api.admin.listLoans, opts)).rejects.toMatchObject(PROFILE_MISSING);
    await expect(as(t, 1).query(api.admin.listLoans, opts)).rejects.toMatchObject(FORBIDDEN);
  });

  test("returns only approved and returned requests, newest first, with exact keys", async () => {
    const { t, u, drill } = await setup();
    await seed(t, drill, u[1], u[2], "pending");
    await seed(t, drill, u[1], u[3], "declined");
    await seed(t, drill, u[1], u[2], "returned");
    await seed(t, drill, u[1], u[3], "approved");
    const { page } = await as(t, 4).query(api.admin.listLoans, opts);
    expect(page.map((l) => [l.status, l.borrowerName])).toEqual([
      ["approved", "User 3"],
      ["returned", "User 2"],
    ]);
    for (const l of page)
      expect(Object.keys(l).sort()).toEqual(["_id", "borrowerName", "endDate", "ownerName", "startDate", "status", "toolName"]);
    expect(page[0].ownerName).toBe("User 1");
  });

  test("a deleted user shows as Unknown neighbor", async () => {
    const { t, u, drill } = await setup();
    await seed(t, drill, u[1], u[3], "approved");
    await t.run((ctx) => ctx.db.delete(u[3]));
    const { page } = await as(t, 4).query(api.admin.listLoans, opts);
    expect(page[0].borrowerName).toBe("Unknown neighbor");
  });

  test("an empty first page does not mean there are no loans", async () => {
    const { t, u, drill } = await setup();
    await seed(t, drill, u[1], u[2], "approved");
    for (let i = 0; i < 60; i++) await seed(t, drill, u[1], u[2], "pending");
    const first = await as(t, 4).query(api.admin.listLoans, opts);
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    let found = 0;
    let cursor: string | null = first.continueCursor;
    for (let i = 0; i < 10 && cursor; i++) {
      const next: { page: unknown[]; isDone: boolean; continueCursor: string } = await as(t, 4).query(api.admin.listLoans, {
        paginationOpts: { numItems: 10, cursor },
      });
      found += next.page.length;
      cursor = next.isDone ? null : next.continueCursor;
    }
    expect(found).toBe(1);
  });
});

describe("admin.listUsers and admin.setTrusted", () => {
  test("both fail without an identity or a profile, and for a regular user, even on themselves", async () => {
    const { t, u } = await setup();
    await expect(t.query(api.admin.listUsers, opts)).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.mutation(api.admin.setTrusted, { id: u[1], trusted: true })).rejects.toMatchObject(NOT_SIGNED_IN);
    const ghost = t.withIdentity(identity(99));
    await expect(ghost.query(api.admin.listUsers, opts)).rejects.toMatchObject(PROFILE_MISSING);
    await expect(ghost.mutation(api.admin.setTrusted, { id: u[1], trusted: true })).rejects.toMatchObject(PROFILE_MISSING);
    await expect(as(t, 1).query(api.admin.listUsers, opts)).rejects.toMatchObject(FORBIDDEN);
    await expect(as(t, 1).mutation(api.admin.setTrusted, { id: u[1], trusted: true })).rejects.toMatchObject(FORBIDDEN);
    expect((await t.run((ctx) => ctx.db.get(u[1])))?.trusted).toBeUndefined();
  });

  test("an admin lists users with only id, display name and flag", async () => {
    const { t } = await setup();
    const { page } = await as(t, 4).query(api.admin.listUsers, opts);
    expect(page.map((p) => p.displayName)).toEqual(["User 4", "User 3", "User 2", "User 1"]);
    for (const p of page) expect(Object.keys(p).sort()).toEqual(["_id", "displayName", "trusted"]);
    expect(page.every((p) => p.trusted === false)).toBe(true);
  });

  test("an admin marks and unmarks a lender without changing anything else", async () => {
    const { t, u } = await setup();
    const before = await t.run((ctx) => ctx.db.get(u[1]));
    await as(t, 4).mutation(api.admin.setTrusted, { id: u[1], trusted: true });
    const marked = await t.run((ctx) => ctx.db.get(u[1]));
    expect(marked).toEqual({ ...before, trusted: true });
    const listed = (await as(t, 4).query(api.admin.listUsers, opts)).page.find((p) => p._id === u[1]);
    expect(listed?.trusted).toBe(true);
    await as(t, 4).mutation(api.admin.setTrusted, { id: u[1], trusted: false });
    expect(await t.run((ctx) => ctx.db.get(u[1]))).toEqual({ ...before, trusted: false });
  });

  test("users.viewer never returns the flag", async () => {
    const { t, u } = await setup();
    await as(t, 4).mutation(api.admin.setTrusted, { id: u[1], trusted: true });
    expect(await as(t, 1).query(api.users.viewer, {})).toEqual({ displayName: "User 1", role: "user" });
  });

  test("a missing user is NOT_FOUND, and a role argument is rejected", async () => {
    const { t, u } = await setup();
    await t.run((ctx) => ctx.db.delete(u[3]));
    await expect(as(t, 4).mutation(api.admin.setTrusted, { id: u[3], trusted: true })).rejects.toMatchObject(NOT_FOUND);
    await expect(as(t, 4).mutation(api.admin.setTrusted, { id: u[1], trusted: true, role: "admin" } as never)).rejects.toThrow();
  });
});
