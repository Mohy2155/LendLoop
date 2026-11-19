import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin";
import { AuthGate } from "@/components/auth-gate";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <p className="mt-2 max-w-prose text-muted">All loans, and which lenders are Trusted Lenders.</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <AdminPanel />
      </AuthGate>
    </div>
  );
}
