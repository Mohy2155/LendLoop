"use client";

import { useEffect } from "react";
import { quietButton } from "@/components/button-styles";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-prose text-muted">
        This page could not load. Try again, and if it keeps failing, come back in a few minutes.
      </p>
      <button type="button" className={`${quietButton} mt-4`} onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
