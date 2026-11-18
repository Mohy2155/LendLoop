import { HomeCta } from "@/components/home-cta";
import { Main } from "@/components/main";

export default function Home() {
  return (
    <Main className="pegboard">
      <div className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
        <h1 className="max-w-[16ch] text-5xl font-semibold sm:text-6xl">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mt-6 max-w-[48ch] text-lg text-muted">
          LendLoop is a board where neighbors list the tools they are happy to lend, and ask to
          borrow what they need for a few days.
        </p>
        <HomeCta />
      </div>
    </Main>
  );
}
