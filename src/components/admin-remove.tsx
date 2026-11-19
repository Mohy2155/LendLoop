"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { primaryButton, quietButton } from "./button-styles";
import { requestMessage } from "./requests";
import { useProfile } from "./viewer-provider";

/** Admin-only Remove for a tool in the signed-in list. Display only: tools.removeAny checks the role. */
export function AdminRemove({ toolId, toolName }: { toolId: Id<"tools">; toolName: string }) {
  const { viewer } = useProfile();
  const removeAny = useMutation(api.tools.removeAny);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Opening the confirm moves focus to Cancel; cancelling returns it to Remove.
  useEffect(() => {
    if (confirming) cancel.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  if (viewer?.role !== "admin") return null;

  if (!confirming)
    return (
      <div className="mt-3">
        <button
          ref={trigger}
          type="button"
          className={quietButton}
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
        >
          Remove<span className="sr-only"> {toolName}</span>
        </button>
      </div>
    );

  return (
    <div className="mt-3">
      <p className="font-semibold">Remove {toolName}? This cannot be undone.</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={primaryButton}
          aria-disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setMessage("");
            try {
              await removeAny({ id: toolId });
            } catch (error) {
              setMessage(requestMessage(error, "We could not remove this. Try again."));
              setBusy(false);
            }
          }}
        >
          Remove
        </button>
        <button
          ref={cancel}
          type="button"
          className={quietButton}
          onClick={() => {
            returnFocus.current = true;
            setConfirming(false);
          }}
        >
          Cancel
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-2 text-sm font-medium">
          {message}
        </p>
      )}
    </div>
  );
}
