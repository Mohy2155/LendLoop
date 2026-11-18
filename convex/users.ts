import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/access";

/**
 * Creates the caller's profile on first sign-in and refreshes the display name afterwards.
 * Takes no input, so a client cannot choose its role or name.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const name = typeof identity.name === "string" ? identity.name.trim() : "";
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (user) {
      if (name && name !== user.displayName) await ctx.db.patch(user._id, { displayName: name });
      return;
    }

    let displayName = name;
    if (!displayName) {
      const counter = await ctx.db.query("neighborCounter").first();
      const n = counter?.next ?? 1;
      if (counter) await ctx.db.patch(counter._id, { next: n + 1 });
      else await ctx.db.insert("neighborCounter", { next: n + 1 });
      displayName = `Neighbor ${n}`;
    }
    await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
      role: "user",
    });
  },
});

/** The caller's own display name and role, or null when signed out or without a profile. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return user && { displayName: user.displayName, role: user.role };
  },
});
