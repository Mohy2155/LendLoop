import { v } from "convex/values";

/**
 * What n8n receives: only the fields it needs to address and word a notification.
 * `ownerName` is sent for a new request only (the owner is the one addressed); borrowers never see it.
 */
export const payloadValidator = v.object({
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"), v.literal("returned")),
  toolName: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  borrowerName: v.string(),
  ownerName: v.optional(v.string()),
});
