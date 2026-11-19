import { beforeEach, vi } from "vitest";

// Every request mutation schedules a webhook call. Give those background runs a config and a
// fetch that succeeds, so tests that are not about notifications stay quiet.
beforeEach(() => {
  vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.test/webhook/request-events");
  vi.stubEnv("N8N_WEBHOOK_SECRET", "test-secret");
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
});
