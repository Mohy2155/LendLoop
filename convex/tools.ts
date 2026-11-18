import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import {
  categoryValidator,
  conditionValidator,
  DESCRIPTION_MAX,
  MAX_TOOLS_PER_USER,
  NAME_MAX,
  VISIBLE_TEXT,
} from "./lib/toolOptions";

// Every function here follows one order: argument validators, requireUser, then (for an
// existing tool) NOT_FOUND and FORBIDDEN, then the text checks, then the per-user cap.
// None takes an owner or a role: the owner is always the caller.

const fields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

/** Trimmed text of 1 to `max` characters with at least one letter or digit, or INVALID_INPUT. */
function cleanText(value: string, max: number) {
  const text = value.trim();
  if (text.length > max || !VISIBLE_TEXT.test(text)) throw new ConvexError({ code: "INVALID_INPUT" });
  return text;
}

function cleanFields(input: { name: string; description: string }) {
  return {
    name: cleanText(input.name, NAME_MAX),
    description: cleanText(input.description, DESCRIPTION_MAX),
  };
}

export const create = mutation({
  args: fields,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const text = cleanFields(args);
    const owned = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .take(MAX_TOOLS_PER_USER);
    if (owned.length >= MAX_TOOLS_PER_USER) throw new ConvexError({ code: "LIMIT_REACHED" });
    await ctx.db.insert("tools", {
      ownerId: user._id,
      category: args.category,
      condition: args.condition,
      ...text,
    });
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect(); // bounded by MAX_TOOLS_PER_USER
    return tools.map(({ _id, name, category, condition, description }) => ({
      _id,
      name,
      category,
      condition,
      description,
    }));
  },
});

export const update = mutation({
  args: { id: v.id("tools"), ...fields },
  handler: async (ctx, { id, ...args }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", id);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    if (tool.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    const text = cleanFields(args);
    await ctx.db.patch("tools", id, { category: args.category, condition: args.condition, ...text });
  },
});

export const remove = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", id);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    if (tool.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
    await ctx.db.delete("tools", id);
  },
});
