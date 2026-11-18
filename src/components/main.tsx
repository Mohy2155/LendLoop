import { ReactNode } from "react";

/** The single main landmark. The skip link targets it, so signed-in navigation sits before it. */
export function Main({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" tabIndex={-1} className={`flex flex-1 flex-col outline-none ${className}`}>
      {children}
    </main>
  );
}
