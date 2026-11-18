import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "My listings" };

export default function MyListingsPage() {
  return (
    <PlaceholderPage title="My listings" description="The tools you have listed for neighbors to borrow." />
  );
}
