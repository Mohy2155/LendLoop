import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PHOTO_MAX, PHOTO_MAX_BYTES } from "./lib/toolOptions";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

const valid = { name: "Hammer", category: "Hand tools", condition: "Good", description: "Claw hammer" } as const;

type T = Awaited<ReturnType<typeof setup>>;

async function setup(count = 3) {
  const t = convexTest(schema);
  for (let n = 1; n <= count; n++) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  return t;
}
const as = (t: T, n: number) => t.withIdentity(identity(n));
const makeAdmin = (t: T, n: number) =>
  t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(n).tokenIdentifier))
      .unique();
    await ctx.db.patch(user!._id, { role: "admin" });
  });

/** A tool owned by user `n`; returns its id. */
async function tool(t: T, n: number) {
  await as(t, n).mutation(api.tools.create, valid);
  const mine = await as(t, n).query(api.tools.listMine, {});
  return mine[0]._id;
}
const store = (t: T, type: string | undefined, size = 10) =>
  t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(size)], type === undefined ? {} : { type })));
const png = (t: T, size?: number) => store(t, "image/png", size);
const exists = (t: T, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
const photosOf = (t: T, id: Id<"tools">) => t.run(async (ctx) => (await ctx.db.get("tools", id))!.photos ?? []);
const attach = (t: T, id: Id<"tools">, photos: Id<"_storage">[]) => t.run((ctx) => ctx.db.patch(id, { photos }));
const drop = (t: T, id: Id<"_storage">) => t.run((ctx) => ctx.storage.delete(id));
const add = (t: T, n: number, id: Id<"tools">, storageId: Id<"_storage">) =>
  as(t, n).mutation(api.tools.addPhoto, { id, storageId });

const NOT_SIGNED_IN = { data: { code: "NOT_SIGNED_IN" } };
const FORBIDDEN = { data: { code: "FORBIDDEN" } };
const NOT_FOUND = { data: { code: "NOT_FOUND" } };
const PHOTO_LIMIT = { data: { code: "PHOTO_LIMIT" } };

describe("tools.generatePhotoUploadUrl", () => {
  test("the owner gets an upload URL", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    expect(typeof (await as(t, 1).mutation(api.tools.generatePhotoUploadUrl, { id }))).toBe("string");
  });

  test("signed-out, another user, an admin who is not the owner and a missing tool are refused", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await makeAdmin(t, 3);
    await expect(t.mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(as(t, 2).mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject(FORBIDDEN);
    await expect(as(t, 3).mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject(FORBIDDEN);
    await as(t, 1).mutation(api.tools.remove, { id });
    await expect(as(t, 1).mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject(NOT_FOUND);
  });

  test("no upload URL is issued once the tool has the maximum number of photos", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await attach(t, id, await Promise.all(Array.from({ length: PHOTO_MAX }, () => png(t))));
    await expect(as(t, 1).mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject(PHOTO_LIMIT);
  });
});

describe("tools.addPhoto", () => {
  test("the owner attaches an uploaded image", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const file = await png(t);
    expect(await add(t, 1, id, file)).toEqual({ ok: true });
    expect(await photosOf(t, id)).toEqual([file]);
  });

  test("a file of exactly the size cap is accepted, one byte more is rejected and deleted", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const exact = await png(t, PHOTO_MAX_BYTES);
    const over = await png(t, PHOTO_MAX_BYTES + 1);
    expect(await add(t, 1, id, exact)).toEqual({ ok: true });
    expect(await add(t, 1, id, over)).toEqual({ ok: false, code: "INVALID_FILE" });
    expect(await exists(t, over)).toBe(false);
    expect(await exists(t, exact)).toBe(true);
    expect(await photosOf(t, id)).toEqual([exact]);
  });

  test.each([
    ["a GIF", "image/gif"],
    ["an SVG", "image/svg+xml"],
    ["HTML", "text/html"],
    ["a loose prefix match", "image/pngx"],
    ["no content type", undefined],
  ])("%s is rejected and the stored file is deleted", async (_label, type) => {
    const t = await setup();
    const id = await tool(t, 1);
    const file = await store(t, type);
    expect(await add(t, 1, id, file)).toEqual({ ok: false, code: "INVALID_FILE" });
    expect(await exists(t, file)).toBe(false);
    expect(await photosOf(t, id)).toEqual([]);
  });

  test("JPEG and WebP are accepted too", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    expect(await add(t, 1, id, await store(t, "image/jpeg"))).toEqual({ ok: true });
    expect(await add(t, 1, id, await store(t, "image/webp"))).toEqual({ ok: true });
    expect(await photosOf(t, id)).toHaveLength(2);
  });

  test("a fourth photo is refused with PHOTO_LIMIT, the file is deleted and the tool keeps three", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const kept = await Promise.all(Array.from({ length: PHOTO_MAX }, () => png(t)));
    for (const file of kept) expect(await add(t, 1, id, file)).toEqual({ ok: true });
    const extra = await png(t);
    expect(await add(t, 1, id, extra)).toEqual({ ok: false, code: "PHOTO_LIMIT" });
    expect(await exists(t, extra)).toBe(false);
    expect(await photosOf(t, id)).toEqual(kept);
    for (const file of kept) expect(await exists(t, file)).toBe(true);
  });

  test("a file that no longer exists is INVALID_FILE and nothing else is deleted", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const inUse = await png(t);
    await attach(t, id, [inUse]);
    const gone = await png(t);
    await drop(t, gone);
    expect(await add(t, 1, id, gone)).toEqual({ ok: false, code: "INVALID_FILE" });
    expect(await exists(t, inUse)).toBe(true);
    expect(await photosOf(t, id)).toEqual([inUse]);
  });

  test("an id already attached to this tool is refused without deleting the photo in use", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const inUse = await png(t);
    await attach(t, id, [inUse]);
    expect(await add(t, 1, id, inUse)).toEqual({ ok: false, code: "INVALID_FILE" });
    expect(await exists(t, inUse)).toBe(true);
    expect(await photosOf(t, id)).toEqual([inUse]);
  });

  test("an id attached to another of the caller's tools is refused without deleting it", async () => {
    const t = await setup();
    const first = await tool(t, 1);
    await as(t, 1).mutation(api.tools.create, { ...valid, name: "Saw" });
    const second = (await as(t, 1).query(api.tools.listMine, {})).find((x) => x.name === "Saw")!._id;
    const inUse = await png(t);
    await attach(t, first, [inUse]);
    expect(await add(t, 1, second, inUse)).toEqual({ ok: false, code: "INVALID_FILE" });
    expect(await exists(t, inUse)).toBe(true);
    expect(await photosOf(t, second)).toEqual([]);
  });

  test("repeated adds never pass the limit (sequential check; Convex serializes writes to one tool)", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const results = [];
    for (let i = 0; i < PHOTO_MAX + 2; i++) results.push(await add(t, 1, id, await png(t)));
    expect(results.filter((r) => r.ok)).toHaveLength(PHOTO_MAX);
    expect(await photosOf(t, id)).toHaveLength(PHOTO_MAX);
  });

  test("signed-out and another user are refused and the tool and the file are unchanged", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await makeAdmin(t, 3);
    const file = await png(t);
    await expect(t.mutation(api.tools.addPhoto, { id, storageId: file })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(add(t, 2, id, file)).rejects.toMatchObject(FORBIDDEN);
    await expect(add(t, 3, id, file)).rejects.toMatchObject(FORBIDDEN);
    expect(await photosOf(t, id)).toEqual([]);
    expect(await exists(t, file)).toBe(true);
  });

  test("a missing tool is NOT_FOUND", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await as(t, 1).mutation(api.tools.remove, { id });
    await expect(add(t, 1, id, await png(t))).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("tools.removePhoto", () => {
  test("the owner removes a photo and its file is deleted", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const [a, b] = [await png(t), await png(t)];
    await attach(t, id, [a, b]);
    await as(t, 1).mutation(api.tools.removePhoto, { id, storageId: a });
    expect(await photosOf(t, id)).toEqual([b]);
    expect(await exists(t, a)).toBe(false);
    expect(await exists(t, b)).toBe(true);
  });

  test("an id that is not on the tool is NOT_FOUND and its file stays", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await as(t, 1).mutation(api.tools.create, { ...valid, name: "Saw" });
    const other = (await as(t, 1).query(api.tools.listMine, {})).find((x) => x.name === "Saw")!._id;
    const elsewhere = await png(t);
    await attach(t, other, [elsewhere]);
    await expect(as(t, 1).mutation(api.tools.removePhoto, { id, storageId: elsewhere })).rejects.toMatchObject(NOT_FOUND);
    expect(await exists(t, elsewhere)).toBe(true);
    expect(await photosOf(t, other)).toEqual([elsewhere]);
  });

  test("signed-out, another user and an admin who is not the owner are refused and nothing changes", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await makeAdmin(t, 3);
    const file = await png(t);
    await attach(t, id, [file]);
    await expect(t.mutation(api.tools.removePhoto, { id, storageId: file })).rejects.toMatchObject(NOT_SIGNED_IN);
    await expect(as(t, 2).mutation(api.tools.removePhoto, { id, storageId: file })).rejects.toMatchObject(FORBIDDEN);
    await expect(as(t, 3).mutation(api.tools.removePhoto, { id, storageId: file })).rejects.toMatchObject(FORBIDDEN);
    expect(await photosOf(t, id)).toEqual([file]);
    expect(await exists(t, file)).toBe(true);
  });

  test("a reference whose file is already gone can still be removed", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const file = await png(t);
    await attach(t, id, [file]);
    await drop(t, file);
    await as(t, 1).mutation(api.tools.removePhoto, { id, storageId: file });
    expect(await photosOf(t, id)).toEqual([]);
  });
});

describe("deleting a tool deletes its files", () => {
  test("the owner's delete removes the stored files", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const files = [await png(t), await png(t)];
    await attach(t, id, files);
    await as(t, 1).mutation(api.tools.remove, { id });
    for (const file of files) expect(await exists(t, file)).toBe(false);
  });

  test("an admin's removeAny removes the stored files", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await makeAdmin(t, 3);
    const file = await png(t);
    await attach(t, id, [file]);
    await as(t, 3).mutation(api.tools.removeAny, { id });
    expect(await exists(t, file)).toBe(false);
  });

  test("a stale reference does not block deleting the listing", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await makeAdmin(t, 3);
    const [a, b] = [await png(t), await png(t)];
    await attach(t, id, [a, b]);
    await drop(t, a);
    await as(t, 1).mutation(api.tools.remove, { id });
    expect(await exists(t, b)).toBe(false);

    const second = await tool(t, 2);
    const stale = await png(t);
    await attach(t, second, [stale]);
    await drop(t, stale);
    await as(t, 3).mutation(api.tools.removeAny, { id: second });
    expect(await t.run((ctx) => ctx.db.get("tools", second))).toBeNull();
  });

  test("a refused delete leaves the files alone", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const file = await png(t);
    await attach(t, id, [file]);
    await expect(as(t, 2).mutation(api.tools.remove, { id })).rejects.toMatchObject(FORBIDDEN);
    await expect(as(t, 2).mutation(api.tools.removeAny, { id })).rejects.toMatchObject(FORBIDDEN);
    expect(await exists(t, file)).toBe(true);
  });
});

describe("photos in the lists", () => {
  test("listMine returns each photo's id and URL, in order", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const [a, b] = [await png(t), await png(t)];
    await attach(t, id, [a, b]);
    const [mine] = await as(t, 1).query(api.tools.listMine, {});
    expect(mine.photos.map((p) => p.id)).toEqual([a, b]);
    for (const p of mine.photos) expect(typeof p.url).toBe("string");
  });

  test("a tool without photos has an empty list in listMine and a null photoUrl in listAll", async () => {
    const t = await setup();
    await tool(t, 1);
    expect((await as(t, 1).query(api.tools.listMine, {}))[0].photos).toEqual([]);
    const res = await as(t, 2).query(api.tools.listAll, { paginationOpts: { numItems: 10, cursor: null } });
    expect(res.page[0].photoUrl).toBeNull();
  });

  test("listAll gives signed-in users only the first photo's URL, with no storage id and no owner", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const [a, b] = [await png(t), await png(t, 11)];
    await attach(t, id, [a, b]);
    const res = await as(t, 2).query(api.tools.listAll, { paginationOpts: { numItems: 10, cursor: null } });
    const item = res.page[0];
    const mine = (await as(t, 1).query(api.tools.listMine, {}))[0].photos;
    expect(item.photoUrl).toBe(mine[0].url);
    expect(item.photoUrl).not.toBe(mine[1].url);
    expect(JSON.stringify(item)).not.toContain(a);
    expect(JSON.stringify(item)).not.toContain(b);
    expect(Object.keys(item).sort()).toEqual([
      "_id",
      "category",
      "condition",
      "description",
      "name",
      "onLoan",
      "photoUrl",
    ]);
  });

  test("listAll gives no photo link when the first photo's file is gone", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const [gone, ok] = [await png(t), await png(t, 11)];
    await attach(t, id, [gone, ok]);
    await drop(t, gone);
    const res = await as(t, 2).query(api.tools.listAll, { paginationOpts: { numItems: 10, cursor: null } });
    expect(res.page[0].photoUrl).toBeNull();
  });

  test("another user asking for an upload URL on a full tool is FORBIDDEN, not PHOTO_LIMIT", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await attach(t, id, await Promise.all(Array.from({ length: PHOTO_MAX }, () => png(t))));
    await expect(as(t, 2).mutation(api.tools.generatePhotoUploadUrl, { id })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  test("a stale reference is skipped in the lists", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    const [gone, ok] = [await png(t), await png(t)];
    await attach(t, id, [gone, ok]);
    await drop(t, gone);
    expect((await as(t, 1).query(api.tools.listMine, {}))[0].photos.map((p) => p.id)).toEqual([ok]);
  });

  test("the public list still has exactly name and category, even for a tool with photos", async () => {
    const t = await setup();
    const id = await tool(t, 1);
    await attach(t, id, [await png(t)]);
    for (const caller of [t, as(t, 2)]) {
      const res = await caller.query(api.tools.listPublic, { paginationOpts: { numItems: 10, cursor: null } });
      expect(res.page).toEqual([{ name: "Hammer", category: "Hand tools" }]);
    }
  });
});
