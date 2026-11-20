import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { isDay } from "./lib/day";
import { verifySigned } from "./lib/signedRequest";

// Routes for the daily n8n reminder workflow. Every call must be HMAC-signed (see lib/signedRequest.ts);
// anything else gets 401 with no body. Each route signs a fixed path, not the one read from the URL.

const status = (code: number) => new Response(null, { status: code });
const OVERDUE_PATH = "/overdue-loans";
const REMINDERS_PATH = "/reminders";

const http = httpRouter();

http.route({
  path: OVERDUE_PATH,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      if (!(await verifySigned(request, "GET", OVERDUE_PATH, await request.text()))) return status(401);
      // `day` is fixed here and passed in, so the query never reads the clock.
      const day = new Date().toISOString().slice(0, 10);
      const loans = await ctx.runQuery(internal.reminders.overdue, { day });
      return Response.json({ day, loans });
    } catch {
      return status(500);
    }
  }),
});

http.route({
  path: REMINDERS_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.text();
      if (!(await verifySigned(request, "POST", REMINDERS_PATH, body))) return status(401);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return status(400);
      }
      const { requestId, day } = (parsed && typeof parsed === "object" ? parsed : {}) as { requestId?: unknown; day?: unknown };
      if (typeof requestId !== "string" || typeof day !== "string" || !isDay(day)) return status(400);
      const result = await ctx.runMutation(internal.reminders.record, { requestId, day });
      return status(result === "ok" ? 200 : 400);
    } catch {
      return status(500);
    }
  }),
});

export default http;
