import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** When the newest reminder for a loan was recorded (newest day first), or undefined if none. Only the time is returned. */
export async function lastReminderAt(ctx: QueryCtx, requestId: Id<"requests">): Promise<number | undefined> {
  const row = await ctx.db
    .query("reminders")
    .withIndex("by_request_day", (q) => q.eq("requestId", requestId))
    .order("desc")
    .first();
  return row?.sentAt;
}
