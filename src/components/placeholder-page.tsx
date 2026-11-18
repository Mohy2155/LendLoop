import { AuthGate } from "@/components/auth-gate";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-prose text-muted">{description}</p>
      {/* Data regions go inside the gate; chrome and headings stay outside it. */}
      <AuthGate>
        <div className="mt-8 rounded-md border border-dashed border-border p-6">
          <p className="font-medium">Not available yet</p>
          <p className="mt-1 text-sm text-muted">This page will fill in as the feature is built.</p>
        </div>
      </AuthGate>
    </div>
  );
}
