// Verifies the HMAC signature n8n puts on a call to the HTTP routes. The secret is the Convex env var
// N8N_WEBHOOK_SECRET (the same one used to sign webhook calls to n8n).
// The signed text is `${timestamp}.${METHOD}.${path}.${body}`: method and path are part of it, so a signature
// for one route is not valid on another. Every failure is just `false`; callers answer 401 with no body.

const WINDOW_MS = 5 * 60 * 1000;

export async function verifySigned(request: Request, method: string, path: string, body: string): Promise<boolean> {
  try {
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!secret) return false; // an empty HMAC key would throw, so check before importing it
    const signature = request.headers.get("x-lendloop-signature") ?? "";
    const timestamp = request.headers.get("x-lendloop-timestamp") ?? "";
    if (!/^[0-9a-f]{64}$/.test(signature) || !/^[0-9]{10,16}$/.test(timestamp)) return false;
    if (Math.abs(Date.now() - Number(timestamp)) > WINDOW_MS) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
    // verify() compares in constant time.
    return await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${timestamp}.${method}.${path}.${body}`));
  } catch {
    return false;
  }
}
