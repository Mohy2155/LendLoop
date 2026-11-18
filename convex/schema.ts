import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  // Single row; hands out the number in "Neighbor N" for users who have no name.
  neighborCounter: defineTable({ next: v.number() }),
});
