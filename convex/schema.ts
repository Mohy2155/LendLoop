import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { categoryValidator, conditionValidator } from "./lib/toolOptions";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    trusted: v.optional(v.boolean()), // Trusted Lender; set by an admin, absent means not trusted
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    photos: v.optional(v.array(v.id("_storage"))), // owner's photos, first one is the cover; absent means none
  }).index("by_owner", ["ownerId"]).index("by_category", ["category"]),

  // An approved request is the loan. `toolName` is a copy so a request still reads if its tool is deleted.
  requests: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"), v.literal("returned")),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_status_endDate", ["status", "endDate"]),

  // One row per loan per day: the write-back from the daily reminder workflow. `day` is the UTC date the run fetched.
  reminders: defineTable({
    requestId: v.id("requests"),
    day: v.string(), // YYYY-MM-DD
    sentAt: v.number(),
  }).index("by_request_day", ["requestId", "day"]),

  // Single row; hands out the number in "Neighbor N" for users who have no name.
  neighborCounter: defineTable({ next: v.number() }),
});
