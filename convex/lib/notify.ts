import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { payloadValidator } from "./notifyPayload";
import type { Infer } from "convex/values";

type Payload = Infer<typeof payloadValidator>;

/**
 * Schedules the n8n webhook call for a request event. Runs inside the caller's mutation, so a
 * refused action schedules nothing and a slow or broken n8n never affects the user's result.
 * The payload is built field by field, never from a row.
 */
export async function queueNotification(
  ctx: MutationCtx,
  request: {
    status: Payload["status"];
    toolName: string;
    startDate: string;
    endDate: string;
    ownerId: Id<"users">;
    borrowerId: Id<"users">;
    cancelledBy?: "owner" | "borrower"; // set for a cancel only
  },
): Promise<void> {
  const name = async (id: Id<"users">) => (await ctx.db.get("users", id))?.displayName ?? "Unknown neighbor";
  const { status, toolName, startDate, endDate, cancelledBy } = request;
  const payload: Payload = { status, toolName, startDate, endDate, borrowerName: await name(request.borrowerId) };
  // The owner is addressed (so their name is sent) for a new request, a pickup and a cancel by the borrower.
  if (status === "pending" || status === "pickedUp" || (status === "cancelled" && cancelledBy === "borrower")) {
    payload.ownerName = await name(request.ownerId);
  }
  if (status === "cancelled") payload.cancelledBy = cancelledBy;
  await ctx.scheduler.runAfter(0, internal.notify.send, { payload, attempt: 1 });
}
