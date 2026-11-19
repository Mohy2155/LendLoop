import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const identity = (n: number) => ({
  tokenIdentifier: `https://issuer.test|user_${n}`,
  subject: `user_${n}`,
  issuer: "https://issuer.test",
  name: `User ${n}`,
});

/** Users 1 (owner of "Drill", description "Cordless") and 2 have profiles. */
async function setup() {
  const t = convexTest(schema);
  for (const n of [1, 2, 3]) await t.withIdentity(identity(n)).mutation(api.users.ensureUser, {});
  const drill = await t.run(async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(1).tokenIdentifier))
      .unique();
    return ctx.db.insert("tools", {
      ownerId: owner!._id,
      name: "Drill",
      category: "Power tools",
      condition: "Good",
      description: "Cordless, secret garage code 1234",
    });
  });
  return { t, drill };
}
type T = Awaited<ReturnType<typeof setup>>["t"];
const as = (t: T, n: number) => t.withIdentity(identity(n));
const calls = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.startsWith("notify"));
const create = (t: T, drill: Id<"tools">) =>
  as(t, 2).mutation(api.requests.create, { toolId: drill, startDate: "2026-06-10", endDate: "2026-06-12" });
const firstRequest = async (t: T) => (await t.run((ctx) => ctx.db.query("requests").first()))!._id;

describe("webhook calls are scheduled by the request mutations", () => {
  // Fake timers keep the scheduled sends from running, so the jobs can be read as they were queued.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("create schedules one pending call with only the new-request fields", async () => {
    const { t, drill } = await setup();
    await create(t, drill);
    const jobs = await calls(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toEqual({
      payload: {
        status: "pending",
        toolName: "Drill",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        borrowerName: "User 2",
        ownerName: "User 1",
      },
      attempt: 1,
    });
    expect(JSON.stringify(jobs[0].args)).not.toContain("garage");
  });

  test("approve and decline schedule borrower-facing calls without the owner's name", async () => {
    for (const [decision, status] of [["approve", "approved"], ["decline", "declined"]] as const) {
      const { t, drill } = await setup();
      await create(t, drill);
      await as(t, 1).mutation(api.requests.decide, { id: await firstRequest(t), decision });
      const jobs = await calls(t);
      expect(jobs).toHaveLength(2);
      expect(jobs[1].args[0]).toEqual({
        payload: { status, toolName: "Drill", startDate: "2026-06-10", endDate: "2026-06-12", borrowerName: "User 2" },
        attempt: 1,
      });
    }
  });

  test("mark returned schedules a returned call without the owner's name", async () => {
    const { t, drill } = await setup();
    await create(t, drill);
    const id = await firstRequest(t);
    await as(t, 1).mutation(api.requests.decide, { id, decision: "approve" });
    await as(t, 1).mutation(api.requests.markReturned, { id });
    const jobs = await calls(t);
    expect(jobs).toHaveLength(3);
    expect(jobs[2].args[0].payload).toEqual({
      status: "returned",
      toolName: "Drill",
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      borrowerName: "User 2",
    });
  });

  test("a missing user shows as Unknown neighbor", async () => {
    const { t, drill } = await setup();
    await create(t, drill);
    await t.run(async (ctx) => {
      const borrower = await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity(2).tokenIdentifier))
        .unique();
      await ctx.db.delete(borrower!._id);
    });
    await as(t, 1).mutation(api.requests.decide, { id: await firstRequest(t), decision: "approve" });
    expect((await calls(t))[1].args[0].payload.borrowerName).toBe("Unknown neighbor");
  });

  test("refused calls schedule nothing", async () => {
    const { t, drill } = await setup();
    await expect(t.mutation(api.requests.create, { toolId: drill, startDate: "2026-06-10", endDate: "2026-06-12" })).rejects.toThrow();
    await expect(as(t, 2).mutation(api.requests.create, { toolId: drill, startDate: "2026-06-12", endDate: "2026-06-10" })).rejects.toThrow();
    expect(await calls(t)).toHaveLength(0);

    await create(t, drill);
    const id = await firstRequest(t);
    await expect(as(t, 2).mutation(api.requests.decide, { id, decision: "approve" })).rejects.toThrow(); // not the owner
    await expect(as(t, 2).mutation(api.requests.markReturned, { id })).rejects.toThrow();
    await expect(as(t, 1).mutation(api.requests.markReturned, { id })).rejects.toThrow(); // not approved
    expect(await calls(t)).toHaveLength(1);

    await as(t, 1).mutation(api.requests.decide, { id, decision: "approve" });
    await expect(as(t, 1).mutation(api.requests.decide, { id, decision: "decline" })).rejects.toThrow(); // not pending
    expect(await calls(t)).toHaveLength(2);
  });

  test("a loan that has not started cannot be returned and schedules nothing", async () => {
    const { t, drill } = await setup();
    await as(t, 2).mutation(api.requests.create, { toolId: drill, startDate: "2999-01-01", endDate: "2999-01-02" });
    const id = await firstRequest(t);
    await as(t, 1).mutation(api.requests.decide, { id, decision: "approve" });
    await expect(as(t, 1).mutation(api.requests.markReturned, { id })).rejects.toThrow();
    expect(await calls(t)).toHaveLength(2);
  });
});

describe("notify.send", () => {
  // Fake timers: retry jobs are only queued, never run, and their delays can be read.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const payload = {
    status: "pending" as const,
    toolName: "Drill",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    borrowerName: "José Ñ",
    ownerName: "User 1",
  };
  const run = (t: T, attempt = 1) => t.action(internal.notify.send, { payload, attempt });
  const stubFetch = (...statuses: number[]) => {
    const fetchMock = vi.fn(async () => new Response(null, { status: statuses.shift() ?? 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  test("posts the body with a signature an independent HMAC reproduces (non-ASCII name)", async () => {
    const { t } = await setup();
    const fetchMock = stubFetch(200);
    await run(t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://n8n.test/webhook/request-events");
    expect(init.method).toBe("POST");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(payload);
    const expected = createHmac("sha256", "test-secret").update(`${headers["x-lendloop-timestamp"]}.${init.body}`).digest("hex");
    expect(headers["x-lendloop-signature"]).toBe(expected);
    expect(Math.abs(Date.now() - Number(headers["x-lendloop-timestamp"]))).toBeLessThan(5000);
  });

  test("503 schedules the next attempt, and a later 200 ends it", async () => {
    const { t } = await setup();
    stubFetch(503);
    await run(t);
    const jobs = await calls(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toEqual({ payload, attempt: 2 });
    expect(jobs[0].scheduledTime - Date.now()).toBe(10_000);
    stubFetch(503);
    await run(t, 2);
    const next = (await calls(t)).find((job) => job.args[0].attempt === 3)!;
    expect(next.scheduledTime - Date.now()).toBe(60_000);
    stubFetch(200);
    await run(t, 3);
    expect(await calls(t)).toHaveLength(2);
  });

  test("a network error is retried", async () => {
    const { t } = await setup();
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    await run(t);
    expect((await calls(t))[0].args[0].attempt).toBe(2);
  });

  test("the third failed attempt ends the run as failed with the status", async () => {
    const { t } = await setup();
    stubFetch(503);
    await expect(run(t, 3)).rejects.toThrow(/3 attempt.*503/);
    expect(await calls(t)).toHaveLength(0);
  });

  test("429 is retried, other 4xx is not", async () => {
    const { t } = await setup();
    stubFetch(429);
    await run(t);
    expect(await calls(t)).toHaveLength(1);
    stubFetch(401);
    await expect(run(t)).rejects.toThrow(/401/);
    expect(await calls(t)).toHaveLength(1);
  });

  test.each([
    ["N8N_WEBHOOK_URL", ""],
    ["N8N_WEBHOOK_SECRET", ""],
  ])("an empty %s fails the run and sends nothing", async (name, value) => {
    const { t } = await setup();
    const fetchMock = stubFetch(200);
    vi.stubEnv(name, value);
    await expect(run(t)).rejects.toThrow(/must both be set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
