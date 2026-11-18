"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { primaryButton } from "@/components/button-styles";

export function HomeCta() {
  return (
    <div className="mt-8 flex min-h-10 items-center">
      <Show when="signed-out">
        <SignInButton>
          <button type="button" className={primaryButton}>
            Sign in to lend or borrow
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/tools" className={primaryButton}>
          Go to tools
        </Link>
      </Show>
    </div>
  );
}
