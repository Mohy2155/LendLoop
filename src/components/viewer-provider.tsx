"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQueries, type RequestForQueries } from "convex/react";
import { api } from "../../convex/_generated/api";

type ProfileState = {
  /** The caller's profile; undefined while loading, null if none exists yet. */
  viewer: { displayName: string; role: "user" | "admin" } | null | undefined;
  /** True when the profile could not be created or loaded for the current session and attempt. */
  failed: boolean;
  retry: () => void;
};

const ProfileContext = createContext<ProfileState | null>(null);

/**
 * Creates the user's profile once per Clerk session (after Convex has authenticated it) and
 * shares it with the signed-in pages. Lives in the signed-in layout so navigating between pages
 * does not repeat the work.
 */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const { sessionId } = useAuth();
  // useQueries returns a query error as a value; useQuery would throw it above the error boundary.
  // The request object must keep its identity between renders, or useQueries re-subscribes forever.
  const requests = useMemo((): RequestForQueries => {
    if (!isAuthenticated) return {};
    return { viewer: { query: api.users.viewer, args: {} } };
  }, [isAuthenticated]);
  const result = useQueries(requests).viewer;
  const queryError = result instanceof Error;
  const viewer = queryError ? undefined : (result as ProfileState["viewer"]);
  const ensureUser = useMutation(api.users.ensureUser);
  const [attempt, setAttempt] = useState(0);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const startedKey = useRef<string | null>(null);
  const key = `${sessionId}:${attempt}`;

  useEffect(() => {
    if (!isAuthenticated || !sessionId || startedKey.current === key) return;
    startedKey.current = key;
    ensureUser({}).then(
      () => setDoneKey(key),
      (error) => {
        console.error(error);
        setFailedKey(key);
      },
    );
  }, [isAuthenticated, sessionId, key, ensureUser]);

  // A query error is not cleared by calling ensureUser again, so retrying reloads the page.
  const retry = useCallback(
    () => (queryError ? window.location.reload() : setAttempt((n) => n + 1)),
    [queryError],
  );
  // Profile creation finished but the profile is gone (for example the row was deleted).
  const failed = failedKey === key || queryError || (doneKey === key && viewer === null);

  return (
    <ProfileContext.Provider value={{ viewer, failed, retry }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileState {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ViewerProvider");
  return value;
}
