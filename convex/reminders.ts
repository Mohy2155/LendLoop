import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal only: called by the signed HTTP routes in http.ts for the daily n8n reminder workflow.

/**
 * Approved loans whose end date is before `day` (YYYY-MM-DD, UTC) and that have no reminder for `day`.
 * Items are built field by field: only what the reminder needs.
 * shortcut: reads every overdue loan in one call, fine at neighborhood scale; page it if that stops being true.
 */
export const overdue = internalQuery({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const loans = await ctx.db
      .query("requests")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", day))
      .collect();
    const items = await Promise.all(
      loans.map(async ({ _id, toolName, endDate, borrowerId }) => {
        const reminded = await ctx.db
          .query("reminders")
          .withIndex("by_request_day", (q) => q.eq("requestId", _id).eq("day", day))
          .unique();
        if (reminded) return null;
        const borrower = await ctx.db.get("users", borrowerId);
        return { requestId: _id, toolName, endDate, borrowerName: borrower?.displayName ?? "Unknown neighbor" };
      }),
    );
    return items.filter((item) => item !== null);
  },
});

/** Records one reminder per loan per day. Repeating a call changes nothing. */
export const record = internalMutation({
  args: { requestId: v.string(), day: v.string() },
  handler: async (ctx, { requestId, day }): Promise<"ok" | "unknown"> => {
    const id = ctx.db.normalizeId("requests", requestId);
    if (!id || !(await ctx.db.get("requests", id))) return "unknown";
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_request_day", (q) => q.eq("requestId", id).eq("day", day))
      .unique();
    if (!existing) await ctx.db.insert("reminders", { requestId: id, day, sentAt: Date.now() });
    return "ok";
  },
});
