import type { Metadata } from "next";
import { AuthGate } from "@/components/auth-gate";
import { MyRequests } from "@/components/requests";

export const metadata: Metadata = { title: "My requests" };

export default function MyRequestsPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">My requests</h1>
      <p className="mt-2 max-w-prose text-muted">The tools you have asked to borrow, and their status.</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <MyRequests />
      </AuthGate>
    </div>
  );
}
