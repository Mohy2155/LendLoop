import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { categoryValidator, conditionValidator } from "./lib/toolOptions";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  }).index("by_owner", ["ownerId"]).index("by_category", ["category"]),

  // An approved request is the loan. `toolName` is a copy so a request still reads if its tool is deleted.
  requests: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined")),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_tool_status", ["toolId", "status"]),

  // Single row; hands out the number in "Neighbor N" for users who have no name.
  neighborCounter: defineTable({ next: v.number() }),
});
