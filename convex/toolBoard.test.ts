import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_ROWS_READ, PAGE_SIZE, safePaging } from "./lib/paging";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

type T = Awaited<ReturnType<typeof setup>>;

async function setup(count = 2) {
  const t = convexTest(schema);
  for (let n = 1; n <= count; n++) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  return t;
}
const as = (t: T, n: number) => t.withIdentity(identity(n));
const makeAdmin = (t: T, n: number) =>
  t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(n).tokenIdentifier))
      .unique();
    await ctx.db.patch(user!._id, { role: "admin" });
  });

type Cat = "Power tools" | "Hand tools" | "Garden" | "Ladders and access" | "Cleaning" | "Other";
/** Inserts tools one by one (oldest first) for the owner of identity `n`. */
const seed = (t: T, n: number, rows: { name: string; category?: Cat }[]) =>
  t.run(async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(n).tokenIdentifier))
      .unique();
    for (const r of rows)
      await ctx.db.insert("tools", {
        ownerId: owner!._id,
        name: r.name,
        category: r.category ?? "Hand tools",
        condition: "Good",
        description: `secret description of ${r.name}`,
      });
  });
const names = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `Tool ${i}` }));
const opts = (numItems: number, cursor: string | null = null, extra: object = {}) => ({
  paginationOpts: { numItems, cursor, ...extra },
});
const NOT_SIGNED_IN = { data: { code: "NOT_SIGNED_IN" } };
const PROFILE_MISSING = { data: { code: "PROFILE_MISSING" } };

/** The same clamp rules for both queries. */
const lists = [
  ["tools.listPublic", (t: T, o: object) => t.query(api.tools.listPublic, o as never)],
  ["tools.listAll", (t: T, o: object) => as(t, 1).query(api.tools.listAll, o as never)],
] as const;

describe.each(lists)("%s paging", (_name, call) => {
  test("an empty board gives an empty finished page", async () => {
    const t = await setup();
    const res = await call(t, opts(10));
    expect(res.page).toEqual([]);
    expect(res.isDone).toBe(true);
  });

  test("newest first, and the cursor reads the rest", async () => {
    const t = await setup();
    await seed(t, 1, names(30));
    const first = await call(t, opts(1000));
    expect(first.page).toHaveLength(PAGE_SIZE);
    expect(first.page[0].name).toBe("Tool 29");
    expect(first.isDone).toBe(false);
    const rest = await call(t, opts(1000, first.continueCursor));
    expect(rest.page.map((x: { name: string }) => x.name)).toEqual(
      Array.from({ length: 6 }, (_, i) => `Tool ${5 - i}`),
    );
    expect(rest.isDone).toBe(true);
  });

  test("an end cursor cannot widen a page, whatever row limit the client sends", async () => {
    const t = await setup();
    await seed(t, 1, names(100));
    const far = await t.run((ctx) => ctx.db.query("tools").order("desc").paginate({ numItems: 100, cursor: null }));
    for (const maximumRowsRead of [undefined, 0, Number.NaN, -1, 0.5, 100000]) {
      const res = await call(t, opts(24, null, { endCursor: far.continueCursor, maximumRowsRead }));
      expect(res.page.length).toBeLessThanOrEqual(MAX_ROWS_READ);
    }
  });

  test("a garbage cursor is rejected without tool data", async () => {
    const t = await setup();
    await seed(t, 1, [{ name: "Hammer" }]);
    const err = await call(t, opts(10, "not-a-cursor")).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain("Hammer");
  });
});

describe("tools.listPublic", () => {
  test("works with no identity and returns exactly name and category", async () => {
    const t = await setup();
    await makeAdmin(t, 2);
    await seed(t, 1, [{ name: "Spade", category: "Garden" }]);
    await seed(t, 2, [{ name: "Drill", category: "Power tools" }]);
    const res = await t.query(api.tools.listPublic, opts(10));
    expect(Object.keys(res).sort()).toEqual(expect.arrayContaining(["continueCursor", "isDone", "page"]));
    expect(res.page).toEqual([
      { name: "Drill", category: "Power tools" },
      { name: "Spade", category: "Garden" },
    ]);
    expect(JSON.stringify(res)).not.toMatch(/secret|ownerId|User 1|admin/);
  });

  test("an identity without a profile gets the same data", async () => {
    const t = await setup();
    await seed(t, 1, [{ name: "Spade" }]);
    const stranger = t.withIdentity(identity(99));
    const res = await stranger.query(api.tools.listPublic, opts(10));
    expect(res.page).toEqual([{ name: "Spade", category: "Hand tools" }]);
  });
});

describe("tools.listAll", () => {
  test("fails without an identity or without a profile", async () => {
    const t = await setup();
    await seed(t, 1, [{ name: "Spade" }]);
    await expect(t.query(api.tools.listAll, opts(10))).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.withIdentity(identity(99)).query(api.tools.listAll, opts(10))).rejects.toMatchObject(PROFILE_MISSING);
  });

  test("returns every owner's tools with the agreed fields and no owner", async () => {
    const t = await setup();
    await seed(t, 1, [{ name: "Spade" }]);
    await seed(t, 2, [{ name: "Drill" }]);
    const res = await as(t, 1).query(api.tools.listAll, opts(10));
    expect(res.page).toHaveLength(2);
    for (const item of res.page)
      expect(Object.keys(item).sort()).toEqual(["_id", "category", "condition", "description", "name", "onLoan", "photoUrl"]);
    expect(JSON.stringify(res)).not.toMatch(/ownerId|User 2/);
  });

  test("an admin sees the same tools and shape as a user", async () => {
    const t = await setup();
    await makeAdmin(t, 2);
    await seed(t, 1, [{ name: "Spade" }]);
    const user = await as(t, 1).query(api.tools.listAll, opts(10));
    const admin = await as(t, 2).query(api.tools.listAll, opts(10));
    expect(admin.page).toEqual(user.page);
  });

  test("the category filter returns only that category across owners, newest first", async () => {
    const t = await setup();
    await seed(t, 1, [
      { name: "Spade", category: "Garden" },
      { name: "Drill", category: "Power tools" },
    ]);
    await seed(t, 2, [{ name: "Hoe", category: "Garden" }]);
    const res = await as(t, 1).query(api.tools.listAll, { ...opts(10), category: "Garden" });
    expect(res.page.map((x) => x.name)).toEqual(["Hoe", "Spade"]);
  });

  test("a category outside the list is rejected", async () => {
    const t = await setup();
    await expect(as(t, 1).query(api.tools.listAll, { ...opts(10), category: "Weapons" } as never)).rejects.toThrow();
  });
});

describe("safePaging", () => {
  test.each([
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, PAGE_SIZE],
    [Number.POSITIVE_INFINITY, PAGE_SIZE],
    [1000, PAGE_SIZE],
    [10, 10],
  ])("page size %s becomes %s", (asked, used) => {
    expect(safePaging({ numItems: asked, cursor: null }).numItems).toBe(used);
  });

  test.each([undefined, 0, Number.NaN, -1, 100000])("the client row limit %s is replaced by the fixed one", (rows) => {
    const out = safePaging({ numItems: 10, cursor: null, maximumRowsRead: rows, maximumBytesRead: 5 });
    expect(out.maximumRowsRead).toBe(MAX_ROWS_READ);
    expect(out).not.toHaveProperty("maximumBytesRead");
  });
});
