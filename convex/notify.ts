import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { payloadValidator } from "./lib/notifyPayload";

// Sends one signed webhook call to n8n. Environment (set in the Convex dashboard):
//   N8N_WEBHOOK_URL     the n8n production webhook URL
//   N8N_WEBHOOK_SECRET  shared secret for the HMAC signature
// The signature is HMAC-SHA256 (hex) over `${timestamp}.${body}`; n8n verifies it and rejects old timestamps.

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [10_000, 60_000]; // before attempt 2 and attempt 3

async function sign(secret: string, timestamp: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const send = internalAction({
  args: { payload: payloadValidator, attempt: v.number() },
  handler: async (ctx, { payload, attempt }): Promise<void> => {
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) throw new Error("N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET must both be set");

    // Signed and sent as the same string; the timestamp and signature are fresh on every attempt.
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = await sign(secret, timestamp, body);

    let failure: string;
    let retryable: boolean;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
        body,
      });
      if (response.ok) return;
      failure = `n8n answered ${response.status}`;
      retryable = response.status >= 500 || response.status === 429; // other 4xx is a configuration problem
    } catch (error) {
      failure = `n8n could not be reached: ${error instanceof Error ? error.message : String(error)}`;
      retryable = true;
    }
    if (retryable && attempt < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt - 1], internal.notify.send, { payload, attempt: attempt + 1 });
      return;
    }
    throw new Error(`Notification not delivered after ${attempt} attempt(s): ${failure}`);
  },
});
