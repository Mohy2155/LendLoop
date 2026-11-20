import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { isDay } from "./lib/day";
import { lastReminderAt } from "./lib/lastReminder";
import { queueNotification } from "./lib/notify";
import { safePaging } from "./lib/paging";
import { hasOpenRequest, toolState } from "./tools";

// Order of checks: argument validators, requireUser, lookup (NOT_FOUND), ownership (FORBIDDEN, or OWN_TOOL on create),
// then the request's own state (NOT_PENDING / NOT_APPROVED / NOT_CANCELLABLE / NOT_PICKED_UP) and the tool's state
// (ON_LOAN / RESERVED). On create: dates (INVALID_INPUT, START_IN_PAST), then ALREADY_REQUESTED, then ON_LOAN.
// Ownership comes before status, so a caller who is not involved learns nothing about a request.
// None takes an owner, borrower or status.

export const create = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    if (tool.ownerId === user._id) throw new ConvexError({ code: "OWN_TOOL" });
    if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) {
      throw new ConvexError({ code: "INVALID_INPUT" });
    }
    // Compares against the server's UTC date; the form's date inputs use the same day.
    if (startDate < new Date().toISOString().slice(0, 10)) throw new ConvexError({ code: "START_IN_PAST" });
    if (await hasOpenRequest(ctx, toolId, user._id)) throw new ConvexError({ code: "ALREADY_REQUESTED" });
    if ((await toolState(ctx, toolId)).onLoan) throw new ConvexError({ code: "ON_LOAN" });
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
    if (decision === "approve") {
      // One loan at a time: nothing else is approved while a request is reserved or the tool is on loan.
      const state = await toolState(ctx, request.toolId);
      if (state.onLoan) throw new ConvexError({ code: "ON_LOAN" });
      if (state.reserved) throw new ConvexError({ code: "RESERVED" });
    }
    const status = decision === "approve" ? "approved" : "declined";
    await ctx.db.patch("requests", id, { status });
    await queueNotification(ctx, { ...request, status });
  },
});

/** The borrower (pending or approved) or the owner (approved) cancels before the pickup is confirmed. */
export const cancel = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get("requests", id);
    if (!request) throw new ConvexError({ code: "NOT_FOUND" });
    const isBorrower = request.borrowerId === user._id; // checked first, so a request whose owner and borrower match counts as the borrower's
    if (!isBorrower && request.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    if (request.status === "pending") {
      if (!isBorrower) throw new ConvexError({ code: "FORBIDDEN" }); // the owner declines instead
    } else if (request.status !== "approved") {
      throw new ConvexError({ code: "NOT_CANCELLABLE" });
    }
    await ctx.db.patch("requests", id, { status: "cancelled" });
    await queueNotification(ctx, { ...request, status: "cancelled", cancelledBy: isBorrower ? "borrower" : "owner" });
  },
});

/** The borrower confirms they received the tool. No date check: they may collect early or late. */
export const confirmPickup = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get("requests", id);
    if (!request) throw new ConvexError({ code: "NOT_FOUND" });
    if (request.borrowerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    if (request.status !== "approved") throw new ConvexError({ code: "NOT_APPROVED" });
    await ctx.db.patch("requests", id, { status: "pickedUp" });
    await queueNotification(ctx, { ...request, status: "pickedUp" });
  },
});

export const markReturned = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get("requests", id);
    if (!request) throw new ConvexError({ code: "NOT_FOUND" });
    if (request.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    if (request.status !== "pickedUp") throw new ConvexError({ code: "NOT_PICKED_UP" });
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
      result.page.map(async ({ _id, toolId, toolName, startDate, endDate, status, borrowerId }) => {
        const borrower = await ctx.db.get("users", borrowerId);
        // Why Approve is unavailable for this pending request, if it is (the owner's own tool, so nothing about other users).
        const state = status === "pending" ? await toolState(ctx, toolId) : null;
        return {
          _id,
          toolName,
          startDate,
          endDate,
          status,
          blocked: state?.onLoan ? ("onLoan" as const) : state?.reserved ? ("reserved" as const) : null,
          borrowerName: borrower?.displayName ?? "Unknown neighbor",
          lastReminderAt: await lastReminderAt(ctx, _id),
        };
      }),
    );
    return { ...result, page };
  },
});
