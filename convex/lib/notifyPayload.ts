import { v } from "convex/values";

/**
 * What n8n receives: only the fields it needs to address and word a notification.
 * `ownerName` is sent when the owner is the one addressed (a new request, a pickup, a cancel by the borrower);
 * borrowers never see it. `cancelledBy` is sent for a cancel only, so n8n can tell who to address.
 */
export const payloadValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("pickedUp"),
    v.literal("declined"),
    v.literal("returned"),
    v.literal("cancelled"),
  ),
  toolName: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  borrowerName: v.string(),
  ownerName: v.optional(v.string()),
  cancelledBy: v.optional(v.union(v.literal("owner"), v.literal("borrower"))),
});
