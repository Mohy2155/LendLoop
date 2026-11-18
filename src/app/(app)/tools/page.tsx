import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Tools" };

export default function ToolsPage() {
  return (
    <PlaceholderPage title="Tools" description="Browse the tools your neighbors are willing to lend." />
  );
}
