import { Suspense } from "react";
import { AppNav, AppNavFallback } from "@/components/app-nav";
import { Main } from "@/components/main";

// Every top-level path added under this group must also be listed in src/lib/nav.ts,
// because src/proxy.ts redirects signed-out visitors based on that list.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<AppNavFallback />}>
        <AppNav />
      </Suspense>
      <Main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">{children}</Main>
    </>
  );
}
