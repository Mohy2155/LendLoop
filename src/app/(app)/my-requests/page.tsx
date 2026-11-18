import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "My requests" };

export default function MyRequestsPage() {
  return (
    <PlaceholderPage title="My requests" description="The tools you have asked to borrow, and their status." />
  );
}
