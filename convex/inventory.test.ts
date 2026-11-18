/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";

// Every public Convex function must be listed here with the check it applies, so a new one cannot
// ship without someone deciding that. `identity` = signed-in identity needed, no profile required;
// `public` = open to anonymous callers (reserved for the tool list); otherwise requireUser / requireAdmin.
const EXPECTED: Record<string, "identity" | "public" | "requireUser" | "requireAdmin"> = {
  "users:ensureUser": "identity",
  "users:viewer": "identity", // returns null, not an error, when signed out
  "tools:create": "requireUser",
  "tools:listMine": "requireUser",
  "tools:update": "requireUser",
  "tools:remove": "requireUser",
  "tools:listPublic": "public", // name and category only
  "tools:listAll": "requireUser",
  "requests:create": "requireUser",
  "requests:decide": "requireUser",
  "requests:listMine": "requireUser",
  "requests:listIncoming": "requireUser",
};

type Registered = { isPublic?: boolean; exportArgs?: () => string };

// Mirrors the Convex bundler: it deploys single-dot source files (not *.test.ts) outside _generated,
// except schema. Loaders stay lazy so skipped files are never imported.
const loaders = import.meta.glob("./**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}") as Record<
  string,
  () => Promise<Record<string, unknown>>
>;
const deployed = Object.entries(loaders).filter(([path]) => {
  const file = path.split("/").pop()!;
  return (
    /^[^.]+\.[^.]+$/.test(file) && !path.startsWith("./_generated/") && !/^schema\./.test(file)
  );
});

const publicFunctions: (readonly [string, Registered])[] = [];
for (const [path, load] of deployed) {
  const moduleName = path.replace(/^\.\//, "").replace(/\.[^.]+$/, "");
  for (const [name, fn] of Object.entries(await load())) {
    if ((fn as Registered)?.isPublic === true) publicFunctions.push([`${moduleName}:${name}`, fn as Registered]);
  }
}

describe("public function inventory", () => {
  test("every public function is listed, and nothing stale is listed", () => {
    expect(publicFunctions.map(([name]) => name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(publicFunctions)("%s declares its arguments and takes no role", (_name, fn) => {
    const args = fn.exportArgs!();
    expect(args).not.toContain('"type":"any"');
    expect(args).not.toContain('"role"');
  });
});
