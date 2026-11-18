import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const identity = (n: number, name?: unknown) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  ...(name === undefined ? {} : { name: name as never }),
});

const allUsers = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("users").collect());

describe("users.ensureUser", () => {
  test("creates one profile with role user from the token name", async () => {
    const t = convexTest(schema);
    await t.withIdentity(identity(1, "Ada Lovelace")).mutation(api.users.ensureUser, {});
    const users = await allUsers(t);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      tokenIdentifier: "https://issuer.test|user_1",
      displayName: "Ada Lovelace",
      role: "user",
    });
    expect(Object.keys(users[0]).sort()).toEqual(
      ["_creationTime", "_id", "displayName", "role", "tokenIdentifier"].sort(),
    );
  });

  test("repeat calls keep one profile and its role", async () => {
    const t = convexTest(schema);
    const as = t.withIdentity(identity(1, "Ada Lovelace"));
    await as.mutation(api.users.ensureUser, {});
    await t.run((ctx) => ctx.db.query("users").first().then((u) => ctx.db.patch(u!._id, { role: "admin" })));
    await as.mutation(api.users.ensureUser, {});
    const users = await allUsers(t);
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("admin");
  });

  test("a changed name updates only the display name, even for an admin", async () => {
    const t = convexTest(schema);
    await t.withIdentity(identity(1, "Ada")).mutation(api.users.ensureUser, {});
    const [before] = await allUsers(t);
    await t.run((ctx) => ctx.db.patch(before._id, { role: "admin" }));
    await t.withIdentity(identity(1, "Ada Lovelace")).mutation(api.users.ensureUser, {});
    const users = await allUsers(t);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      displayName: "Ada Lovelace",
      role: "admin",
      tokenIdentifier: before.tokenIdentifier,
    });
  });

  test("an unauthenticated call fails and creates nothing", async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.users.ensureUser, {})).rejects.toMatchObject({
      data: { code: "NOT_SIGNED_IN" },
    });
    expect(await allUsers(t)).toHaveLength(0);
  });

  test("any argument is rejected", async () => {
    const t = convexTest(schema);
    await expect(
      t.withIdentity(identity(1, "Ada")).mutation(api.users.ensureUser, { role: "admin" } as never),
    ).rejects.toThrow(/Unexpected field `role`/);
    expect(await allUsers(t)).toHaveLength(0);
  });

  test.each([undefined, "", "   ", null, 42])("a missing, blank or non-string name (%j) becomes Neighbor N", async (name) => {
    const t = convexTest(schema);
    await t.withIdentity(identity(1, name)).mutation(api.users.ensureUser, {});
    await t.withIdentity(identity(2, name)).mutation(api.users.ensureUser, {});
    const names = (await allUsers(t)).map((u) => u.displayName).sort();
    expect(names).toEqual(["Neighbor 1", "Neighbor 2"]);
  });

  test("a later call with no name keeps the existing name", async () => {
    const t = convexTest(schema);
    await t.withIdentity(identity(1)).mutation(api.users.ensureUser, {});
    await t.withIdentity(identity(1, "")).mutation(api.users.ensureUser, {});
    expect((await allUsers(t))[0].displayName).toBe("Neighbor 1");
  });

  test("a named user does not use the counter", async () => {
    const t = convexTest(schema);
    await t.withIdentity(identity(1, "Ada")).mutation(api.users.ensureUser, {});
    await t.withIdentity(identity(2)).mutation(api.users.ensureUser, {});
    const byName = (await allUsers(t)).map((u) => u.displayName).sort();
    expect(byName).toEqual(["Ada", "Neighbor 1"]);
  });
});

describe("users.viewer", () => {
  test("returns only the caller's display name and role", async () => {
    const t = convexTest(schema);
    const as = t.withIdentity(identity(1, "Ada Lovelace"));
    await as.mutation(api.users.ensureUser, {});
    await t.withIdentity(identity(2, "Grace Hopper")).mutation(api.users.ensureUser, {});
    expect(await as.query(api.users.viewer, {})).toEqual({ displayName: "Ada Lovelace", role: "user" });
  });

  test("returns null when signed in without a profile", async () => {
    const t = convexTest(schema);
    expect(await t.withIdentity(identity(1, "Ada")).query(api.users.viewer, {})).toBeNull();
  });

  test("returns null without throwing when unauthenticated", async () => {
    const t = convexTest(schema);
    expect(await t.query(api.users.viewer, {})).toBeNull();
  });

  test("any argument is rejected", async () => {
    const t = convexTest(schema);
    await expect(
      t.withIdentity(identity(1, "Ada")).query(api.users.viewer, { userId: "x" } as never),
    ).rejects.toThrow(/Unexpected field `userId`/);
  });
});
