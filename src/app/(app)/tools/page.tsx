import type { Metadata } from "next";
import { AuthGate } from "@/components/auth-gate";
import { AllTools } from "@/components/tool-board";

export const metadata: Metadata = { title: "Tools" };

export default function ToolsPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">Tools</h1>
      <p className="mt-2 max-w-prose text-muted">Browse the tools your neighbors are willing to lend.</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <AllTools />
      </AuthGate>
    </div>
  );
}
