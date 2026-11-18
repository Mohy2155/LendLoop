"use client";

import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/logo";
import { compactPrimaryButton, compactQuietButton } from "@/components/button-styles";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Logo />
          <span>LendLoop</span>
        </Link>
        {/* Fixed-size slot so the header does not shift while Clerk loads. */}
        <div className="flex min-h-10 min-w-[9.75rem] items-center justify-end gap-2">
          <Show when="signed-out">
            <SignInButton>
              <button type="button" className={compactQuietButton}>
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button type="button" className={compactPrimaryButton}>
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
