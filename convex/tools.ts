import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/access";
import { safePaging } from "./lib/paging";
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

/** Admin only: removes any listing. Requests keep their saved tool name. */
export const removeAny = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get("tools", id))) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.delete("tools", id);
  },
});

/**
 * True when an approved request for the tool includes `today` (YYYY-MM-DD, UTC).
 * Note: reads all of the tool's approved requests; fine until a tool has thousands.
 */
async function onLoanToday(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const approved = await ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  return approved.some((r) => r.startDate <= today && today <= r.endDate);
}

// Reads of the whole board. Each builds its items field by field, never from the row itself,
// so a field added to `tools` later is not exposed by accident.

/** Open to anyone, including signed-out visitors: name and category only, tools not on loan today. */
export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ name: v.string(), category: categoryValidator })),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("tools").order("desc").paginate(safePaging(paginationOpts));
    const today = new Date().toISOString().slice(0, 10);
    // A page can come back shorter than requested (or empty) when some of its tools are on loan.
    const loans = await Promise.all(result.page.map((tool) => onLoanToday(ctx, tool._id, today)));
    return {
      ...result,
      page: result.page.filter((_, i) => !loans[i]).map(({ name, category }) => ({ name, category })),
    };
  },
});

export const listAll = query({
  args: { paginationOpts: paginationOptsValidator, category: v.optional(categoryValidator) },
  handler: async (ctx, { paginationOpts, category }) => {
    await requireUser(ctx);
    const tools = category
      ? ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category))
      : ctx.db.query("tools");
    const result = await tools.order("desc").paginate(safePaging(paginationOpts));
    // Note: uses the server's UTC date; not refreshed until the query re-runs.
    const today = new Date().toISOString().slice(0, 10);
    const page = await Promise.all(
      result.page.map(async ({ _id, name, category, condition, description }) => ({
        _id,
        name,
        category,
        condition,
        description,
        onLoan: await onLoanToday(ctx, _id, today),
      })),
    );
    return { ...result, page };
  },
});
