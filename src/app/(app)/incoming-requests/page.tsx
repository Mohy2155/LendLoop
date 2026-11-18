import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Incoming requests" };

export default function IncomingRequestsPage() {
  return (
    <PlaceholderPage
      title="Incoming requests"
      description="Requests from neighbors to borrow your tools."
    />
  );
}
