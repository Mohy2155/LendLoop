import type { Metadata } from "next";
import { AuthGate } from "@/components/auth-gate";
import { MyListings } from "@/components/my-listings";

export const metadata: Metadata = { title: "My listings" };

export default function MyListingsPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">My listings</h1>
      <p className="mt-2 max-w-prose text-muted">The tools you have listed for neighbors to borrow.</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <MyListings />
      </AuthGate>
    </div>
  );
}
