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

  // Single row; hands out the number in "Neighbor N" for users who have no name.
  neighborCounter: defineTable({ next: v.number() }),
});
