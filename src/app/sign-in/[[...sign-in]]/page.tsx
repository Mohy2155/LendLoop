import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { Main } from "@/components/main";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Main className="items-center justify-center py-10">
      <Suspense>
        <SignIn />
      </Suspense>
    </Main>
  );
}
