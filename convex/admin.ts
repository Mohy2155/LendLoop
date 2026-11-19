import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/access";
import { safePaging } from "./lib/paging";

// Every function here starts with requireAdmin. Items are built field by field, never from the row.

/** Every loan (approved or returned request), newest first. A page can come back short or empty. */
export const listLoans = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const result = await ctx.db
      .query("requests")
      .order("desc")
      .filter((q) => q.or(q.eq(q.field("status"), "approved"), q.eq(q.field("status"), "returned")))
      .paginate(safePaging(paginationOpts));
    const name = async (id: (typeof result.page)[number]["ownerId"]) => (await ctx.db.get("users", id))?.displayName ?? "Unknown neighbor";
    const page = await Promise.all(
      result.page.map(async ({ _id, toolName, startDate, endDate, status, ownerId, borrowerId }) => ({
        _id,
        toolName,
        startDate,
        endDate,
        status,
        ownerName: await name(ownerId),
        borrowerName: await name(borrowerId),
      })),
    );
    return { ...result, page };
  },
});

export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const result = await ctx.db.query("users").order("desc").paginate(safePaging(paginationOpts));
    return {
      ...result,
      page: result.page.map(({ _id, displayName, trusted }) => ({ _id, displayName, trusted: trusted ?? false })),
    };
  },
});

export const setTrusted = mutation({
  args: { id: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { id, trusted }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get("users", id))) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch("users", id, { trusted });
  },
});
