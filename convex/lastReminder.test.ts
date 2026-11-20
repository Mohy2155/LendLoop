import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reminderText } from "./lib/reminderText";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});
const opts = { paginationOpts: { numItems: 10, cursor: null } };

/** User 1 owns the Drill, user 2 borrows it (approved), user 3 is an admin, user 4 is unrelated. */
async function setup() {
  const t = convexTest(schema);
  for (const n of [1, 2, 3, 4]) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  const loan = await t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const id = (n: number) => users.find((u) => u.displayName === `User ${n}`)!._id;
    await ctx.db.patch(id(3), { role: "admin" });
    const tool = await ctx.db.insert("tools", { ownerId: id(1), name: "Drill", category: "Power tools", condition: "Good", description: "Cordless" });
    return ctx.db.insert("requests", {
      toolId: tool, toolName: "Drill", ownerId: id(1), borrowerId: id(2), startDate: "2026-06-01", endDate: "2026-06-05", status: "approved",
    });
  });
  const remind = (requestId: Id<"requests">, day: string, sentAt: number) =>
    t.run((ctx) => ctx.db.insert("reminders", { requestId, day, sentAt }));
  const as = (n: number) => t.withIdentity(identity(n));
  return { loan, remind, as };
}

const BASE = ["_id", "endDate", "startDate", "status", "toolName"];

describe("lastReminderAt on the loan lists", () => {
  test("absent without a reminder, present with one, with the exact key sets", async () => {
    const { remind, as, loan } = await setup();
    const none = [(await as(2).query(api.requests.listMine, opts)).page[0], (await as(1).query(api.requests.listIncoming, opts)).page[0], (await as(3).query(api.admin.listLoans, opts)).page[0]];
    for (const item of none) expect("lastReminderAt" in item).toBe(false);

    await remind(loan, "2026-06-08", 1000);
    const mine = (await as(2).query(api.requests.listMine, opts)).page[0];
    const incoming = (await as(1).query(api.requests.listIncoming, opts)).page[0];
    const admin = (await as(3).query(api.admin.listLoans, opts)).page[0];
    expect(Object.keys(mine).sort()).toEqual([...BASE, "lastReminderAt"].sort());
    expect(Object.keys(incoming).sort()).toEqual([...BASE, "borrowerName", "lastReminderAt"].sort());
    expect(Object.keys(admin).sort()).toEqual([...BASE, "borrowerName", "lastReminderAt", "ownerName"].sort());
    for (const item of [mine, incoming, admin]) expect(item.lastReminderAt).toBe(1000);
    // The borrower still never sees the owner.
    expect(JSON.stringify(mine)).not.toContain("User 1");
  });

  test("with reminders on two days it is the newer day's time", async () => {
    const { remind, as, loan } = await setup();
    await remind(loan, "2026-06-09", 9000);
    await remind(loan, "2026-06-08", 8000);
    expect((await as(2).query(api.requests.listMine, opts)).page[0].lastReminderAt).toBe(9000);
  });

  test("someone unrelated to the loan sees none of it", async () => {
    const { remind, as, loan } = await setup();
    await remind(loan, "2026-06-08", 1000);
    expect((await as(4).query(api.requests.listMine, opts)).page).toEqual([]);
    expect((await as(4).query(api.requests.listIncoming, opts)).page).toEqual([]);
  });
});

describe("reminderText", () => {
  const at = (iso: string) => new Date(iso).getTime();
  test("counts UTC calendar days", () => {
    const now = at("2026-06-10T09:00:00Z");
    expect(reminderText(at("2026-06-10T00:00:01Z"), now)).toBe("Reminder sent today");
    expect(reminderText(at("2026-06-09T23:59:59Z"), now)).toBe("Reminder sent 1 day ago");
    expect(reminderText(at("2026-06-08T12:00:00Z"), now)).toBe("Reminder sent 2 days ago");
  });
  test("a reminder newer than the page's clock reading reads as today", () => {
    expect(reminderText(at("2026-06-10T00:10:00Z"), at("2026-06-09T23:50:00Z"))).toBe("Reminder sent today");
  });
  test("is nothing when there is no reminder", () => {
    expect(reminderText(undefined, Date.now())).toBeNull();
  });
});
