import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton } from "@/components/button-styles";
import { Main } from "@/components/main";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Main className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
      <h1 className="text-4xl font-semibold">Page not found</h1>
      <p className="mt-3 max-w-prose text-muted">
        That address does not match a page on LendLoop. Check the link, or go back to the start.
      </p>
      <Link href="/" className={`${primaryButton} mt-6 self-start`}>
        Back to home
      </Link>
    </Main>
  );
}
