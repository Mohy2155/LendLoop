import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_TOOLS_PER_USER } from "./lib/toolOptions";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

const valid = { name: "Hammer", category: "Hand tools", condition: "Good", description: "Claw hammer" } as const;
const BLANK = "   ";

type T = Awaited<ReturnType<typeof setup>>;

/** A fresh backend with profiles for users 1..count; user n is `t.withIdentity(identity(n))`. */
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
const userId = (t: T, n: number) =>
  t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(n).tokenIdentifier))
      .unique();
    return user!._id;
  });
const allTools = (t: T) => t.run((ctx) => ctx.db.query("tools").collect());
const seedTools = (t: T, ownerId: Id<"users">, count: number) =>
  t.run(async (ctx) => {
    for (let i = 0; i < count; i++) await ctx.db.insert("tools", { ...valid, ownerId, name: `Tool ${i}` });
  });
const create = (t: T, n: number, args: object = valid) => as(t, n).mutation(api.tools.create, args as never);

const NOT_SIGNED_IN = { data: { code: "NOT_SIGNED_IN" } };
const PROFILE_MISSING = { data: { code: "PROFILE_MISSING" } };
const FORBIDDEN = { data: { code: "FORBIDDEN" } };
const NOT_FOUND = { data: { code: "NOT_FOUND" } };
const INVALID_INPUT = { data: { code: "INVALID_INPUT" } };

describe("tools.create", () => {
  test("fails without a verified identity, even with invalid text", async () => {
    const t = await setup();
    await expect(t.mutation(api.tools.create, valid)).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.mutation(api.tools.create, { ...valid, name: BLANK })).rejects.toMatchObject(NOT_SIGNED_IN);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("fails without a profile, even with invalid text", async () => {
    const t = convexTest(schema);
    await expect(create(t, 1)).rejects.toMatchObject(PROFILE_MISSING);
    await expect(create(t, 1, { ...valid, name: BLANK })).rejects.toMatchObject(PROFILE_MISSING);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("sets the owner from the caller, for a user and for an admin", async () => {
    const t = await setup();
    await makeAdmin(t, 2);
    await create(t, 1);
    await create(t, 2);
    const owners = (await allTools(t)).map((tool) => tool.ownerId).sort();
    expect(owners).toEqual([await userId(t, 1), await userId(t, 2)].sort());
  });

  test("rejects an owner argument", async () => {
    const t = await setup();
    const other = await userId(t, 2);
    await expect(create(t, 1, { ...valid, ownerId: other })).rejects.toThrow(/Unexpected field `ownerId`/);
    expect(await allTools(t)).toHaveLength(0);
  });

  test.each([
    { category: "Weapons" },
    { condition: "Brand new" },
    { category: "hand tools" },
  ])("rejects a value outside the lists, even when signed out (%j)", async (bad) => {
    const t = await setup();
    // Signed out, only an argument validator can fail first; a schema check would give NOT_SIGNED_IN.
    await expect(t.mutation(api.tools.create, { ...valid, ...bad } as never)).rejects.toThrow(/Validator error/);
    await expect(create(t, 1, { ...valid, ...bad })).rejects.toThrow(/Validator error/);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("stores the text trimmed", async () => {
    const t = await setup();
    await create(t, 1, { ...valid, name: "  Hammer  ", description: "\n Claw hammer \t" });
    const [tool] = await allTools(t);
    expect(tool).toMatchObject({ name: "Hammer", description: "Claw hammer", category: "Hand tools", condition: "Good" });
  });

  test.each([
    { name: "" },
    { name: BLANK },
    { name: "x".repeat(61) },
    { name: "\u200B" },
    { name: "---" },
    { description: "" },
    { description: BLANK },
    { description: "x".repeat(301) },
    { description: "\u200B\u200B" },
  ])("rejects bad text with INVALID_INPUT and stores nothing (%j)", async (bad) => {
    const t = await setup();
    await expect(create(t, 1, { ...valid, ...bad })).rejects.toMatchObject(INVALID_INPUT);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("accepts text of exactly the limits", async () => {
    const t = await setup();
    await create(t, 1, { ...valid, name: "x".repeat(60), description: "y".repeat(300) });
    expect(await allTools(t)).toHaveLength(1);
  });

  describe("the per-user cap", () => {
    test("allows the 50th and rejects the 51st, without affecting another user", async () => {
      const t = await setup();
      await seedTools(t, await userId(t, 1), MAX_TOOLS_PER_USER - 1);
      await create(t, 1);
      await expect(create(t, 1)).rejects.toMatchObject({ data: { code: "LIMIT_REACHED" } });
      expect(await allTools(t)).toHaveLength(MAX_TOOLS_PER_USER);
      await create(t, 2);
      expect(await allTools(t)).toHaveLength(MAX_TOOLS_PER_USER + 1);
    });

    test("checks the text before the cap", async () => {
      const t = await setup();
      await seedTools(t, await userId(t, 1), MAX_TOOLS_PER_USER);
      await expect(create(t, 1, { ...valid, name: BLANK })).rejects.toMatchObject(INVALID_INPUT);
    });

    test("deleting a tool frees a place", async () => {
      const t = await setup();
      await seedTools(t, await userId(t, 1), MAX_TOOLS_PER_USER);
      const [first] = await allTools(t);
      await as(t, 1).mutation(api.tools.remove, { id: first._id });
      await create(t, 1);
      expect(await allTools(t)).toHaveLength(MAX_TOOLS_PER_USER);
    });
  });
});

describe("tools.listMine", () => {
  test("fails without an identity and without a profile", async () => {
    const t = await setup();
    await expect(t.query(api.tools.listMine, {})).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(as(t, 3).query(api.tools.listMine, {})).rejects.toMatchObject(PROFILE_MISSING);
  });

  test("returns only the caller's tools, newest first, with exactly the public fields", async () => {
    const t = await setup();
    await create(t, 1, { ...valid, name: "First" });
    await create(t, 2, { ...valid, name: "Other user's" });
    await create(t, 1, { ...valid, name: "Second" });
    const mine = await as(t, 1).query(api.tools.listMine, {});
    expect(mine.map((tool) => tool.name)).toEqual(["Second", "First"]);
    for (const tool of mine) {
      expect(Object.keys(tool).sort()).toEqual(["_id", "category", "condition", "description", "name", "photos"]);
    }
  });

  test("an admin who owns tools gets the same fields", async () => {
    const t = await setup();
    await makeAdmin(t, 1);
    await create(t, 1);
    const [tool] = await as(t, 1).query(api.tools.listMine, {});
    expect(Object.keys(tool).sort()).toEqual(["_id", "category", "condition", "description", "name", "photos"]);
  });

  test("an admin sees only their own tools", async () => {
    const t = await setup();
    await makeAdmin(t, 2);
    await create(t, 1);
    expect(await as(t, 2).query(api.tools.listMine, {})).toEqual([]);
  });

  test("rejects any argument", async () => {
    const t = await setup();
    await expect(as(t, 1).query(api.tools.listMine, { ownerId: "x" } as never)).rejects.toThrow(/Unexpected field/);
  });
});

/** Shared setup for update and remove: user 1 owns one tool; user 2 is another user. */
async function withTool() {
  const t = await setup();
  await create(t, 1);
  const [tool] = await allTools(t);
  return { t, id: tool._id };
}
const update = (t: T, n: number, id: Id<"tools">, changes: object = {}) =>
  as(t, n).mutation(api.tools.update, { id, ...valid, ...changes } as never);
const remove = (t: T, n: number, id: Id<"tools">) => as(t, n).mutation(api.tools.remove, { id });

describe("tools.update", () => {
  test("fails without an identity and without a profile, even with invalid text", async () => {
    const { t, id } = await withTool();
    await expect(t.mutation(api.tools.update, { id, ...valid })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(t.mutation(api.tools.update, { id, ...valid, name: BLANK })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(update(t, 3, id)).rejects.toMatchObject(PROFILE_MISSING);
    await expect(update(t, 3, id, { name: BLANK })).rejects.toMatchObject(PROFILE_MISSING);
    expect((await allTools(t))[0].name).toBe("Hammer");
  });

  test("the owner changes the fields and the owner stays the same", async () => {
    const { t, id } = await withTool();
    const before = (await allTools(t))[0];
    await update(t, 1, id, { name: "  Mallet ", category: "Garden", condition: "Worn", description: "Rubber" });
    const [after] = await allTools(t);
    expect(after).toMatchObject({ name: "Mallet", category: "Garden", condition: "Worn", description: "Rubber", ownerId: before.ownerId });
  });

  test("an owner who is an admin can edit", async () => {
    const { t, id } = await withTool();
    await makeAdmin(t, 1);
    await update(t, 1, id, { name: "Changed" });
    expect((await allTools(t))[0].name).toBe("Changed");
  });

  test("rejects an owner argument", async () => {
    const { t, id } = await withTool();
    const before = (await allTools(t))[0];
    await expect(update(t, 1, id, { ownerId: await userId(t, 2) })).rejects.toThrow(/Unexpected field `ownerId`/);
    expect((await allTools(t))[0]).toEqual(before);
  });

  test("another user and a non-owner admin get FORBIDDEN and the tool is unchanged, even with invalid text", async () => {
    const { t, id } = await withTool();
    await expect(update(t, 2, id, { name: "Taken" })).rejects.toMatchObject(FORBIDDEN);
    await expect(update(t, 2, id, { name: BLANK })).rejects.toMatchObject(FORBIDDEN);
    await makeAdmin(t, 2);
    await expect(update(t, 2, id, { name: "Taken" })).rejects.toMatchObject(FORBIDDEN);
    expect((await allTools(t))[0].name).toBe("Hammer");
  });

  test("a deleted tool gives NOT_FOUND, even with invalid text", async () => {
    const { t, id } = await withTool();
    await remove(t, 1, id);
    await expect(update(t, 1, id)).rejects.toMatchObject(NOT_FOUND);
    await expect(update(t, 1, id, { name: BLANK })).rejects.toMatchObject(NOT_FOUND);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("an id of another table fails the validator", async () => {
    const { t } = await withTool();
    const user = await userId(t, 1);
    await expect(update(t, 1, user as never)).rejects.toThrow(/tools/);
    // Signed out, only the argument validator can reject the id before the caller is checked.
    await expect(t.mutation(api.tools.update, { id: user as never, ...valid })).rejects.toThrow(/Validator error/);
  });

  test.each([{ category: "Weapons" }, { condition: "Brand new" }])("rejects a value outside the lists (%j)", async (bad) => {
    const { t, id } = await withTool();
    await expect(update(t, 1, id, bad)).rejects.toThrow(/Validator error/);
    expect((await allTools(t))[0]).toMatchObject({ category: "Hand tools", condition: "Good" });
    await expect(t.mutation(api.tools.update, { id, ...valid, ...bad } as never)).rejects.toThrow(/Validator error/);
  });

  test.each([{ name: BLANK }, { name: "x".repeat(61) }, { description: BLANK }, { description: "x".repeat(301) }])(
    "rejects bad text with INVALID_INPUT and changes nothing (%j)",
    async (bad) => {
      const { t, id } = await withTool();
      await expect(update(t, 1, id, bad)).rejects.toMatchObject(INVALID_INPUT);
      expect((await allTools(t))[0]).toMatchObject({ name: "Hammer", description: "Claw hammer" });
    },
  );
});

describe("tools.remove", () => {
  test("fails without an identity and without a profile", async () => {
    const { t, id } = await withTool();
    await expect(t.mutation(api.tools.remove, { id })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(remove(t, 3, id)).rejects.toMatchObject(PROFILE_MISSING);
    expect(await allTools(t)).toHaveLength(1);
  });

  test("the owner deletes the tool, and an owner who is an admin can too", async () => {
    const { t, id } = await withTool();
    await remove(t, 1, id);
    expect(await allTools(t)).toHaveLength(0);
    await create(t, 1);
    await makeAdmin(t, 1);
    await remove(t, 1, (await allTools(t))[0]._id);
    expect(await allTools(t)).toHaveLength(0);
  });

  test("another user and a non-owner admin get FORBIDDEN and the tool remains", async () => {
    const { t, id } = await withTool();
    await expect(remove(t, 2, id)).rejects.toMatchObject(FORBIDDEN);
    await makeAdmin(t, 2);
    await expect(remove(t, 2, id)).rejects.toMatchObject(FORBIDDEN);
    expect(await allTools(t)).toHaveLength(1);
  });

  test("an already deleted tool gives NOT_FOUND", async () => {
    const { t, id } = await withTool();
    await remove(t, 1, id);
    await expect(remove(t, 1, id)).rejects.toMatchObject(NOT_FOUND);
  });

  test("an id of another table fails the validator", async () => {
    const { t } = await withTool();
    const user = await userId(t, 1);
    await expect(remove(t, 1, user as never)).rejects.toThrow(/tools/);
    await expect(t.mutation(api.tools.remove, { id: user as never })).rejects.toThrow(/Validator error/);
    expect(await allTools(t)).toHaveLength(1);
  });
});
