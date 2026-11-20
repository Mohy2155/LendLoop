import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const DAY = "2026-06-10";

async function setup() {
  const t = convexTest(schema);
  const { owner, borrower, tool } = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { tokenIdentifier: "o", displayName: "Olive", role: "user" });
    const borrower = await ctx.db.insert("users", { tokenIdentifier: "b", displayName: "José Ñ", role: "user" });
    const tool = await ctx.db.insert("tools", {
      ownerId: owner,
      name: "Drill",
      category: "Power tools",
      condition: "Good",
      description: "Cordless, garage code 1234",
    });
    return { owner, borrower, tool };
  });
  const loan = (status: "pending" | "approved" | "declined" | "returned", endDate: string, who: Id<"users"> = borrower) =>
    t.run((ctx) =>
      ctx.db.insert("requests", { toolId: tool, toolName: "Drill", ownerId: owner, borrowerId: who, startDate: "2026-01-01", endDate, status }),
    );
  const rows = () => t.run((ctx) => ctx.db.query("reminders").collect());
  const overdue = (day = DAY) => t.query(internal.reminders.overdue, { day });
  const record = (requestId: string, day = DAY) => t.mutation(internal.reminders.record, { requestId, day });
  return { t, loan, rows, overdue, record, owner, borrower, tool };
}

describe("reminders.overdue", () => {
  test("lists an overdue loan with exactly the four fields", async () => {
    const { loan, overdue } = await setup();
    const id = await loan("approved", "2026-06-09");
    const list = await overdue();
    expect(list).toEqual([{ requestId: id, toolName: "Drill", endDate: "2026-06-09", borrowerName: "José Ñ" }]);
    expect(JSON.stringify(list)).not.toContain("garage");
  });

  test("the end date is the boundary: today is not overdue, yesterday is", async () => {
    const { loan, overdue } = await setup();
    await loan("approved", DAY);
    await loan("approved", "2026-06-11");
    expect(await overdue()).toEqual([]);
    const id = await loan("approved", "2026-06-09");
    expect((await overdue()).map((l) => l.requestId)).toEqual([id]);
  });

  test("pending, declined and returned requests are never listed", async () => {
    const { loan, overdue } = await setup();
    for (const status of ["pending", "declined", "returned"] as const) await loan(status, "2026-06-01");
    expect(await overdue()).toEqual([]);
  });

  test("a loan already reminded for the day is not listed, but is again the next day", async () => {
    const { loan, overdue, record } = await setup();
    const id = await loan("approved", "2026-06-01");
    await record(id);
    expect(await overdue()).toEqual([]);
    expect((await overdue("2026-06-11")).map((l) => l.requestId)).toEqual([id]);
  });

  test("a reminder from yesterday does not hide the loan today", async () => {
    const { loan, overdue, record } = await setup();
    const id = await loan("approved", "2026-06-01");
    await record(id, "2026-06-09");
    expect((await overdue()).map((l) => l.requestId)).toEqual([id]);
  });

  test("a missing borrower shows as Unknown neighbor", async () => {
    const { t, loan, overdue, borrower } = await setup();
    await loan("approved", "2026-06-01");
    await t.run((ctx) => ctx.db.delete(borrower));
    expect((await overdue())[0].borrowerName).toBe("Unknown neighbor");
  });
});

describe("reminders.record", () => {
  test("is idempotent: the same call twice leaves one row", async () => {
    const { loan, record, rows } = await setup();
    const id = await loan("approved", "2026-06-01");
    expect(await record(id)).toBe("ok");
    expect(await record(id)).toBe("ok");
    expect(await rows()).toHaveLength(1);
  });

  test("a later day adds a second row", async () => {
    const { loan, record, rows } = await setup();
    const id = await loan("approved", "2026-06-01");
    await record(id);
    await record(id, "2026-06-11");
    expect((await rows()).map((r) => r.day).sort()).toEqual([DAY, "2026-06-11"]);
  });

  test("an unknown id, a malformed id and an id from another table give unknown and write nothing", async () => {
    const { loan, record, rows, owner } = await setup();
    const id = await loan("approved", "2026-06-01");
    expect(await record(owner)).toBe("unknown"); // a users id
    expect(await record("not-an-id")).toBe("unknown");
    expect(await record(id.slice(0, -2))).toBe("unknown");
    expect(await rows()).toHaveLength(0);
  });
});
