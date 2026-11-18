import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { requireAdmin, requireUser } from "./lib/access";
import schema from "./schema";

const id = {
  tokenIdentifier: "https://issuer.test|user_1",
  subject: "user_1",
  issuer: "https://issuer.test",
  name: "Ada",
};

async function withProfile(role: "user" | "admin") {
  const t = convexTest(schema);
  await t.withIdentity(id).mutation(api.users.ensureUser, {});
  if (role === "admin") {
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      await ctx.db.patch(user!._id, { role: "admin" });
    });
  }
  return t;
}

describe("requireUser", () => {
  test("fails with NOT_SIGNED_IN without an identity", async () => {
    const t = convexTest(schema);
    await expect(t.run((ctx) => requireUser(ctx))).rejects.toMatchObject({
      data: { code: "NOT_SIGNED_IN" },
    });
  });

  test("fails with PROFILE_MISSING when the identity has no profile", async () => {
    const t = convexTest(schema);
    await expect(t.withIdentity(id).run((ctx) => requireUser(ctx))).rejects.toMatchObject({
      data: { code: "PROFILE_MISSING" },
    });
  });

  test("returns the profile of a regular user", async () => {
    const t = await withProfile("user");
    const user = await t.withIdentity(id).run((ctx) => requireUser(ctx));
    expect(user).toMatchObject({ tokenIdentifier: id.tokenIdentifier, role: "user" });
  });
});

describe("requireAdmin", () => {
  test("fails with NOT_SIGNED_IN without an identity", async () => {
    const t = convexTest(schema);
    await expect(t.run((ctx) => requireAdmin(ctx))).rejects.toMatchObject({
      data: { code: "NOT_SIGNED_IN" },
    });
  });

  test("fails with PROFILE_MISSING without a profile", async () => {
    const t = convexTest(schema);
    await expect(t.withIdentity(id).run((ctx) => requireAdmin(ctx))).rejects.toMatchObject({
      data: { code: "PROFILE_MISSING" },
    });
  });

  test("fails with FORBIDDEN for a regular user", async () => {
    const t = await withProfile("user");
    await expect(t.withIdentity(id).run((ctx) => requireAdmin(ctx))).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  test("passes for an admin", async () => {
    const t = await withProfile("admin");
    const user = await t.withIdentity(id).run((ctx) => requireAdmin(ctx));
    expect(user.role).toBe("admin");
  });

  test("a demoted admin is rejected on the next call with the same identity", async () => {
    const t = await withProfile("admin");
    const as = t.withIdentity(id);
    await as.run((ctx) => requireAdmin(ctx));
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      await ctx.db.patch(user!._id, { role: "user" });
    });
    await expect(as.run((ctx) => requireAdmin(ctx))).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });
});
