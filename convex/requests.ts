import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { isDay } from "./lib/day";
import { lastReminderAt } from "./lib/lastReminder";
import { queueNotification } from "./lib/notify";
import { safePaging } from "./lib/paging";

// Order of checks: argument validators, requireUser, lookup (NOT_FOUND), ownership (FORBIDDEN),
// state (NOT_PENDING / NOT_APPROVED / NOT_STARTED), dates (INVALID_INPUT). None takes an owner, borrower or status.

export const create = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) {
      throw new ConvexError({ code: "INVALID_INPUT" });
    }
    const fields = { toolName: tool.name, ownerId: tool.ownerId, borrowerId: user._id, startDate, endDate };
    await ctx.db.insert("requests", { toolId, ...fields, status: "pending" });
    await queueNotification(ctx, { ...fields, status: "pending" });
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
    const status = decision === "approve" ? "approved" : "declined";
    await ctx.db.patch("requests", id, { status });
    await queueNotification(ctx, { ...request, status });
  },
});

export const markReturned = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get("requests", id);
    if (!request) throw new ConvexError({ code: "NOT_FOUND" });
    if (request.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    if (request.status !== "approved") throw new ConvexError({ code: "NOT_APPROVED" });
    // shortcut: compares against the server's UTC date, same as the on-loan check.
    if (request.startDate > new Date().toISOString().slice(0, 10)) throw new ConvexError({ code: "NOT_STARTED" });
    await ctx.db.patch("requests", id, { status: "returned" });
    await queueNotification(ctx, { ...request, status: "returned" });
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
    const page = await Promise.all(
      result.page.map(async ({ _id, toolName, startDate, endDate, status }) => ({
        _id,
        toolName,
        startDate,
        endDate,
        status,
        lastReminderAt: await lastReminderAt(ctx, _id),
      })),
    );
    return { ...result, page };
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
        return {
          _id,
          toolName,
          startDate,
          endDate,
          status,
          borrowerName: borrower?.displayName ?? "Unknown neighbor",
          lastReminderAt: await lastReminderAt(ctx, _id),
        };
      }),
    );
    return { ...result, page };
  },
});
