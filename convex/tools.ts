import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type DatabaseReader, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/access";
import { safePaging } from "./lib/paging";
import {
  categoryValidator,
  conditionValidator,
  DESCRIPTION_MAX,
  MAX_TOOLS_PER_USER,
  NAME_MAX,
  PHOTO_MAX,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
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

/** Deletes stored files that still exist (a file removed elsewhere must not block deleting the tool). */
async function deleteFiles(ctx: MutationCtx, ids: Id<"_storage">[]) {
  for (const id of ids) if (await ctx.db.system.get("_storage", id)) await ctx.storage.delete(id);
}

/** A photo's id with its URL; photos whose file is gone are left out. */
async function photoEntries(ctx: QueryCtx, ids: Id<"_storage">[]) {
  const urls = await Promise.all(ids.map((id) => ctx.storage.getUrl(id)));
  return ids.flatMap((id, i) => (urls[i] ? [{ id, url: urls[i] }] : []));
}

/** The tool for a photo action: signed in, found, and owned by the caller (any role). */
async function ownedTool(ctx: MutationCtx, id: Id<"tools">) {
  const user = await requireUser(ctx);
  const tool = await ctx.db.get("tools", id);
  if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
  if (tool.ownerId !== user._id) throw new ConvexError({ code: "FORBIDDEN" });
  return { user, tool };
}

export const generatePhotoUploadUrl = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    const { tool } = await ownedTool(ctx, id);
    if ((tool.photos?.length ?? 0) >= PHOTO_MAX) throw new ConvexError({ code: "PHOTO_LIMIT" });
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Attaches an uploaded file. A rejected file is deleted and reported as a result, not thrown:
 * a thrown error would roll the deletion back. A missing file, or one already attached to any of the
 * caller's tools, is refused without deleting anything, so a retry cannot remove a photo in use.
 */
export const addPhoto = mutation({
  args: { id: v.id("tools"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const { user, tool } = await ownedTool(ctx, id);
    const file = await ctx.db.system.get("_storage", storageId);
    const owned = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .take(MAX_TOOLS_PER_USER);
    if (!file || owned.some((t) => t.photos?.includes(storageId))) return { ok: false, code: "INVALID_FILE" } as const;
    const photos = tool.photos ?? [];
    if (!PHOTO_TYPES.includes(file.contentType ?? "") || file.size > PHOTO_MAX_BYTES) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID_FILE" } as const;
    }
    if (photos.length >= PHOTO_MAX) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "PHOTO_LIMIT" } as const;
    }
    await ctx.db.patch("tools", id, { photos: [...photos, storageId] });
    return { ok: true } as const;
  },
});

export const removePhoto = mutation({
  args: { id: v.id("tools"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const { tool } = await ownedTool(ctx, id);
    const photos = tool.photos ?? [];
    if (!photos.includes(storageId)) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch("tools", id, { photos: photos.filter((p) => p !== storageId) });
    await deleteFiles(ctx, [storageId]);
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
    return Promise.all(
      tools.map(async ({ _id, name, category, condition, description, photos }) => ({
        _id,
        name,
        category,
        condition,
        description,
        photos: await photoEntries(ctx, photos ?? []),
      })),
    );
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
    await deleteFiles(ctx, tool.photos ?? []);
    await ctx.db.delete("tools", id);
  },
});

/** Admin only: removes any listing. Requests keep their saved tool name. */
export const removeAny = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get("tools", id);
    if (!tool) throw new ConvexError({ code: "NOT_FOUND" });
    await deleteFiles(ctx, tool.photos ?? []);
    await ctx.db.delete("tools", id);
  },
});

/** A tool's state, read from its requests: on loan (a picked-up request) or reserved (an approved one). Not a Convex function. */
export async function toolState(ctx: { db: DatabaseReader }, toolId: Id<"tools">) {
  const first = (status: "pickedUp" | "approved") =>
    ctx.db
      .query("requests")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
      .first();
  const [loan, reserved] = await Promise.all([first("pickedUp"), first("approved")]);
  return { onLoan: loan !== null, reserved: reserved !== null };
}

/** True when the borrower has a pending or approved request on the tool. Not a Convex function. */
export async function hasOpenRequest(ctx: { db: DatabaseReader }, toolId: Id<"tools">, borrowerId: Id<"users">) {
  const first = (status: "pending" | "approved") =>
    ctx.db
      .query("requests")
      .withIndex("by_tool_borrower_status", (q) => q.eq("toolId", toolId).eq("borrowerId", borrowerId).eq("status", status))
      .first();
  const [pending, approved] = await Promise.all([first("pending"), first("approved")]);
  return pending !== null || approved !== null;
}

// Reads of the whole board. Each builds its items field by field, never from the row itself,
// so a field added to `tools` later is not exposed by accident.

/** Open to anyone, including signed-out visitors: name and category only, tools that are not on loan. */
export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ name: v.string(), category: categoryValidator })),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("tools").order("desc").paginate(safePaging(paginationOpts));
    // A page can come back shorter than requested (or empty) when some of its tools are on loan.
    const states = await Promise.all(result.page.map((tool) => toolState(ctx, tool._id)));
    return {
      ...result,
      page: result.page.filter((_, i) => !states[i].onLoan).map(({ name, category }) => ({ name, category })),
    };
  },
});

export const listAll = query({
  args: { paginationOpts: paginationOptsValidator, category: v.optional(categoryValidator) },
  handler: async (ctx, { paginationOpts, category }) => {
    const user = await requireUser(ctx);
    const tools = category
      ? ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category))
      : ctx.db.query("tools");
    const result = await tools.order("desc").paginate(safePaging(paginationOpts));
    const page = await Promise.all(
      result.page.map(async ({ _id, name, category, condition, description, photos }) => {
        const state = await toolState(ctx, _id);
        return {
          _id,
          name,
          category,
          condition,
          description,
          availability: state.onLoan ? ("onLoan" as const) : state.reserved ? ("reserved" as const) : ("available" as const),
          requested: await hasOpenRequest(ctx, _id, user._id), // the caller's own request only
          photoUrl: photos?.[0] ? await ctx.storage.getUrl(photos[0]) : null,
        };
      }),
    );
    return { ...result, page };
  },
});
