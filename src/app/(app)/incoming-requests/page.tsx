import type { Metadata } from "next";
import { AuthGate } from "@/components/auth-gate";
import { IncomingRequests } from "@/components/requests";

export const metadata: Metadata = { title: "Incoming requests" };

export default function IncomingRequestsPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">Incoming requests</h1>
      <p className="mt-2 max-w-prose text-muted">Requests from neighbors to borrow your tools.</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <IncomingRequests />
      </AuthGate>
    </div>
  );
}
