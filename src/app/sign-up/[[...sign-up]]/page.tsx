import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { Main } from "@/components/main";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <Main className="items-center justify-center py-10">
      <Suspense>
        <SignUp />
      </Suspense>
    </Main>
  );
}
