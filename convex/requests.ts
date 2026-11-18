import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { safePaging } from "./lib/paging";

// Order of checks: argument validators, requireUser, lookup (NOT_FOUND), ownership (FORBIDDEN),
// state (NOT_PENDING), dates (INVALID_INPUT). None takes an owner, borrower or status.

/** A real calendar day written YYYY-MM-DD (rejects 2026-02-31). */
function isDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const create = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) {
      throw new ConvexError({ code: "INVALID_INPUT" });
    }
    await ctx.db.insert("requests", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: user._id,
      startDate,
      endDate,
      status: "pending",
    });
  },
});

export const decide = mutation({
  args: { id: v.id("requests"), decision: v.union(v.literal("approve"), v.literal("decline")) },
  handler: async (ctx, { id, decision }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get("requests", id);
    if (!request) throw new ConvexError({ code: "NOT_FOUND" });
    if (request.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    if (request.status !== "pending") throw new ConvexError({ code: "NOT_PENDING" });
    await ctx.db.patch("requests", id, { status: decision === "approve" ? "approved" : "declined" });
  },
});

// Lists build each item field by field, never from the row itself.

export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const user = await requireUser(ctx);
    const result = await ctx.db
      .query("requests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .paginate(safePaging(paginationOpts));
    return {
      ...result,
      page: result.page.map(({ _id, toolName, startDate, endDate, status }) => ({
        _id,
        toolName,
        startDate,
        endDate,
        status,
      })),
    };
  },
});

export const listIncoming = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const user = await requireUser(ctx);
    const result = await ctx.db
      .query("requests")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .paginate(safePaging(paginationOpts));
    const page = await Promise.all(
      result.page.map(async ({ _id, toolName, startDate, endDate, status, borrowerId }) => {
        const borrower = await ctx.db.get("users", borrowerId);
        return { _id, toolName, startDate, endDate, status, borrowerName: borrower?.displayName ?? "Unknown neighbor" };
      }),
    );
    return { ...result, page };
  },
});
