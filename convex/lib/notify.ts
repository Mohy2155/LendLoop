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
  },
): Promise<void> {
  const name = async (id: Id<"users">) => (await ctx.db.get("users", id))?.displayName ?? "Unknown neighbor";
  const { status, toolName, startDate, endDate } = request;
  const payload: Payload = { status, toolName, startDate, endDate, borrowerName: await name(request.borrowerId) };
  if (status === "pending") payload.ownerName = await name(request.ownerId);
  await ctx.scheduler.runAfter(0, internal.notify.send, { payload, attempt: 1 });
}
