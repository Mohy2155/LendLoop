"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="border-b border-border">
      <ul className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 sm:px-6">
        {NAV_ITEMS.map((item) => {
          const exact = pathname === item.href;
          const child = !exact && pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={exact ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-offset-[-2px] ${
                  exact || child
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Same-size placeholder shown while the nav suspends. */
export function AppNavFallback() {
  return <div aria-hidden="true" className="h-[calc(2.75rem+1px)] border-b border-border" />;
}
