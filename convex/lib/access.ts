import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

/** The verified identity, or NOT_SIGNED_IN. */
export async function requireIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "NOT_SIGNED_IN" });
  return identity;
}

/** The caller's profile, or NOT_SIGNED_IN / PROFILE_MISSING. Every protected function starts here. */
export async function requireUser(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "PROFILE_MISSING" });
  return user;
}

/** Like requireUser, but FORBIDDEN unless the stored role is admin. */
export async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError({ code: "FORBIDDEN" });
  return user;
}
