"use client";

import { ReactNode, useEffect, useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { primaryButton, quietButton } from "@/components/button-styles";

/** How long "Clerk signed in, Convex not yet authenticated" may last before it is reported as broken. */
const BACKEND_AUTH_GRACE_MS = 10_000;

type GateState = "loading" | "authenticated" | "signed-out" | "waiting" | "backend-error";

/**
 * Combines Clerk and Convex auth state. Convex reports `isAuthenticated: false` while Clerk is
 * signed out and does not return to loading when Clerk signs in, so "Clerk signed in, Convex not
 * authenticated" is shown as a skeleton first and only reported as an error after a grace period.
 */
function useGateState(): GateState {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  // The session for which the grace period ran out; a different session starts a new grace period.
  const [expiredFor, setExpiredFor] = useState<string | null>(null);

  const session = sessionId ?? "none";
  const waitingOnBackend = isLoaded && !!isSignedIn && !isLoading && !isAuthenticated;

  useEffect(() => {
    if (!waitingOnBackend) return;
    const timer = setTimeout(() => setExpiredFor(session), BACKEND_AUTH_GRACE_MS);
    return () => clearTimeout(timer);
  }, [waitingOnBackend, session]);

  if (isLoading) return "loading";
  if (isAuthenticated) return "authenticated";
  if (!isSignedIn) return "signed-out";
  return expiredFor === session ? "backend-error" : "waiting";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useGateState();

  useEffect(() => {
    if (state === "backend-error") {
      console.error(
        "Signed in to Clerk but Convex did not authenticate the session. Check the Clerk " +
          "Convex integration and CLERK_FRONTEND_API_URL on the Convex deployment.",
      );
    }
  }, [state]);

  switch (state) {
    case "authenticated":
      return <>{children}</>;
    case "signed-out":
      return <SignInPrompt />;
    case "backend-error":
      return <BackendError />;
    default:
      return <GateSkeleton />;
  }
}

function GateSkeleton() {
  return (
    <div role="status" className="space-y-3 py-6">
      <span className="sr-only">Loading</span>
      <div className="h-5 w-1/3 rounded bg-border motion-safe:animate-pulse" />
      <div className="h-5 w-2/3 rounded bg-border motion-safe:animate-pulse" />
      <div className="h-5 w-1/2 rounded bg-border motion-safe:animate-pulse" />
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="py-6">
      <p className="mb-4 text-muted">Sign in to see this page.</p>
      <SignInButton>
        <button type="button" className={primaryButton}>
          Sign in
        </button>
      </SignInButton>
    </div>
  );
}

function BackendError() {
  return (
    <div role="alert" className="my-6 rounded-md border border-border bg-surface p-4">
      <p className="font-semibold">We could not load your account data.</p>
      <p className="mt-1 text-muted">You are signed in, but this page could not reach its data. Reload the page to try again.</p>
      <button
        type="button"
        className={`${quietButton} mt-3`}
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}
