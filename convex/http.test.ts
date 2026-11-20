import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

const SECRET = "test-secret"; // stubbed into N8N_WEBHOOK_SECRET by vitest.setup.ts
const TODAY = "2026-06-10";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${TODAY}T09:00:00Z`) }));
afterEach(() => vi.useRealTimers());

const sign = (ts: string, method: string, path: string, body: string, key = SECRET) =>
  createHmac("sha256", key).update(`${ts}.${method}.${path}.${body}`).digest("hex");

async function setup() {
  const t = convexTest(schema);
  const { loan, other } = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { tokenIdentifier: "o", displayName: "Olive", role: "user" });
    const borrower = await ctx.db.insert("users", { tokenIdentifier: "b", displayName: "José Ñ", role: "user" });
    const tool = await ctx.db.insert("tools", { ownerId: owner, name: "Drill", category: "Power tools", condition: "Good", description: "garage code 1234" });
    const loan = await ctx.db.insert("requests", {
      toolId: tool, toolName: "Drill", ownerId: owner, borrowerId: borrower, startDate: "2026-06-01", endDate: "2026-06-08", status: "approved",
    });
    return { loan, other: owner };
  });
  const rows = () => t.run((ctx) => ctx.db.query("reminders").collect());
  return { t, loan, other, rows };
}

type Over = { ts?: string; sig?: string; headers?: Record<string, string>; method?: string };
/** A call signed for `signPath` and `signMethod` (defaults: the request's own), with parts overridable. */
function call(t: Awaited<ReturnType<typeof setup>>["t"], method: string, path: string, body = "", over: Over & { signPath?: string; signMethod?: string } = {}) {
  const ts = over.ts ?? String(Date.now());
  const signature = over.sig ?? sign(ts, over.signMethod ?? method, over.signPath ?? path, body);
  const headers: Record<string, string> = { "x-lendloop-timestamp": ts, "x-lendloop-signature": signature, ...over.headers };
  return t.fetch(path, { method, headers, ...(method === "POST" ? { body } : {}) });
}
const getList = (t: Awaited<ReturnType<typeof setup>>["t"], over: Parameters<typeof call>[4] = {}) => call(t, "GET", "/overdue-loans", "", over);
const post = (t: Awaited<ReturnType<typeof setup>>["t"], body: string, over: Parameters<typeof call>[4] = {}) => call(t, "POST", "/reminders", body, over);

describe("GET /overdue-loans", () => {
  test("a signed call returns the day and the minimal loans", async () => {
    const { t, loan } = await setup();
    const res = await getList(t);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ day: TODAY, loans: [{ requestId: loan, toolName: "Drill", endDate: "2026-06-08", borrowerName: "José Ñ" }] });
    expect(JSON.stringify(json)).not.toContain("garage");
  });

  test.each([
    ["a wrong secret", (ts: string) => ({ sig: sign(ts, "GET", "/overdue-loans", "", "other") })],
    ["a missing signature", () => ({ headers: { "x-lendloop-signature": "" } })],
    ["a short signature", () => ({ sig: "abcd" })],
    ["a non-hex signature", () => ({ sig: "z".repeat(64) })],
    ["a non-numeric timestamp", () => ({ ts: "yesterday" })],
    ["a stale timestamp", () => ({ ts: String(Date.now() - 6 * 60_000) })],
    ["a future timestamp", () => ({ ts: String(Date.now() + 6 * 60_000) })],
    ["a signature made for the other endpoint", () => ({ signPath: "/reminders", signMethod: "POST" })],
  ])("%s gets 401 with no data", async (_name, make) => {
    const { t } = await setup();
    const res = await getList(t, make(String(Date.now())));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  test.each([["unset", undefined], ["empty", ""]])("a %s secret gets 401 even for a matching signature", async (_n, value) => {
    const { t } = await setup();
    vi.stubEnv("N8N_WEBHOOK_SECRET", value as string);
    const res = await getList(t, { sig: sign(String(Date.now()), "GET", "/overdue-loans", "", "") });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  test("an unexpected failure answers an empty 500", async () => {
    const { t } = await setup();
    const spy = vi.spyOn(Response, "json").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await getList(t);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
  });

  test("a POST to /overdue-loans is not routed", async () => {
    const { t, rows } = await setup();
    expect((await call(t, "POST", "/overdue-loans", "{}")).status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });
});

describe("POST /reminders", () => {
  test("a signed write-back records one row, and a repeat changes nothing", async () => {
    const { t, loan, rows } = await setup();
    const body = JSON.stringify({ requestId: loan, day: TODAY });
    expect((await post(t, body)).status).toBe(200);
    expect((await post(t, body)).status).toBe(200);
    expect(await rows()).toHaveLength(1);
    // The loan is no longer listed for that day.
    expect((await (await getList(t)).json()).loans).toEqual([]);
  });

  test.each([
    ["a wrong secret", (ts: string, body: string) => ({ sig: sign(ts, "POST", "/reminders", body, "other") })],
    ["a short signature", () => ({ sig: "abcd" })],
    ["a non-hex signature", () => ({ sig: "z".repeat(64) })],
    ["a non-numeric timestamp", () => ({ ts: "yesterday" })],
    ["a stale timestamp", () => ({ ts: String(Date.now() - 6 * 60_000) })],
    ["a future timestamp", () => ({ ts: String(Date.now() + 6 * 60_000) })],
    ["a signature made for the other endpoint", () => ({ signPath: "/overdue-loans", signMethod: "GET" })],
  ])("%s gets 401 and writes nothing", async (_name, make) => {
    const { t, loan, rows } = await setup();
    const body = JSON.stringify({ requestId: loan, day: TODAY });
    const res = await post(t, body, make(String(Date.now()), body));
    expect(res.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  test("a body changed after signing gets 401", async () => {
    const { t, loan, rows } = await setup();
    const ts = String(Date.now());
    const signed = JSON.stringify({ requestId: loan, day: TODAY });
    const res = await post(t, JSON.stringify({ requestId: loan, day: "2026-06-09" }), { ts, sig: sign(ts, "POST", "/reminders", signed) });
    expect(res.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  test.each([["unset", undefined], ["empty", ""]])("a %s secret gets 401 and writes nothing", async (_n, value) => {
    const { t, loan, rows } = await setup();
    vi.stubEnv("N8N_WEBHOOK_SECRET", value as string);
    const body = JSON.stringify({ requestId: loan, day: TODAY });
    expect((await post(t, body, { sig: sign(String(Date.now()), "POST", "/reminders", body, "") })).status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  test("bad input gets 400 and writes nothing", async () => {
    const { t, loan, other, rows } = await setup();
    for (const body of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ day: TODAY }), // no requestId
      JSON.stringify({ requestId: loan }), // no day
      JSON.stringify({ requestId: 5, day: TODAY }),
      JSON.stringify({ requestId: loan, day: "2026-02-31" }),
      JSON.stringify({ requestId: loan, day: "tomorrow" }),
      JSON.stringify({ requestId: "garbage", day: TODAY }),
      JSON.stringify({ requestId: other, day: TODAY }), // an id from another table
    ]) {
      const res = await post(t, body);
      expect([body, res.status]).toEqual([body, 400]);
      expect(await res.text()).toBe("");
    }
    expect(await rows()).toHaveLength(0);
  });

  test("a GET to /reminders is not routed", async () => {
    const { t } = await setup();
    expect((await call(t, "GET", "/reminders")).status).toBe(404);
  });
});
