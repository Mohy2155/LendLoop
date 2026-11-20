"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PAGE_SIZE } from "../../convex/lib/paging";
import { reminderText } from "../../convex/lib/reminderText";
import { primaryButton, quietButton } from "./button-styles";
import { Empty, Loading, LoadMore, pill } from "./tool-board";

/** Plain wording for a refused call. Anything without a known code gets the fallback. */
export function requestMessage(error: unknown, fallback: string) {
  const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
  switch (code) {
    case "NOT_FOUND":
      return "This no longer exists.";
    case "FORBIDDEN":
      return "You cannot do this.";
    case "NOT_PENDING":
      return "This request was already decided.";
    case "NOT_APPROVED":
      return "This loan was already marked returned.";
    case "NOT_STARTED":
      return "This loan has not started yet.";
    case "INVALID_INPUT":
      return "Choose a start and an end date, with the end on or after the start.";
    default:
      return fallback;
  }
}

/** "Reminder sent 2 days ago" when an automated reminder was recorded for the loan; nothing otherwise. */
export function ReminderLine({ at }: { at: number | undefined }) {
  const [now] = useState(() => Date.now()); // read once per mount, so render stays pure
  const text = reminderText(at, now);
  return text ? <span>{text}</span> : null;
}

function dates(start: string, end: string) {
  return start === end ? start : `${start} to ${end}`;
}

/** "Request to borrow" for one tool: a start and an end date. */
export function RequestForm({ toolId, toolName }: { toolId: Id<"tools">; toolName: string }) {
  const create = useMutation(api.requests.create);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // When the form closes, put focus back on the button that opened it.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
  }

  if (!open)
    return (
      <div className="mt-3">
        <button ref={trigger} type="button" className={quietButton} onClick={() => setOpen(true)}>
          Request to borrow<span className="sr-only"> {toolName}</span>
        </button>
      </div>
    );

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
          await create({ toolId, startDate: start, endDate: end });
          close();
          setStart("");
          setEnd("");
        } catch (error) {
          setMessage(requestMessage(error, "We could not send this request. Try again."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm font-medium">
        Start
        <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 block min-h-10 rounded-md border border-border bg-surface px-3 py-2" />
      </label>
      <label className="text-sm font-medium">
        End
        <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 block min-h-10 rounded-md border border-border bg-surface px-3 py-2" />
      </label>
      <button type="submit" className={primaryButton} aria-disabled={busy}>
        Send request
      </button>
      <button type="button" className={quietButton} onClick={close}>
        Cancel
      </button>
      {message && (
        <p role="alert" className="basis-full text-sm font-medium">
          {message}
        </p>
      )}
    </form>
  );
}

/** The requests the caller has made. */
export function MyRequests() {
  const { results, status, loadMore } = usePaginatedQuery(api.requests.listMine, {}, { initialNumItems: PAGE_SIZE });
  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0) return <Empty text="You have not asked to borrow anything yet." />;
  return (
    <>
      <ul className="mt-6 space-y-3">
        {results.map((r) => (
          <li key={r._id} className="rounded-md border border-border bg-surface p-4">
            <h2 className="text-lg font-semibold break-words">{r.toolName}</h2>
            <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
              <span>{dates(r.startDate, r.endDate)}</span>
              <span className={pill}>
                <span className="sr-only">Status: </span>
                {r.status}
              </span>
              <ReminderLine at={r.lastReminderAt} />
            </p>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} end="That is every request." />
    </>
  );
}

/** Requests for the caller's tools, with Approve and Decline on pending ones. */
export function IncomingRequests() {
  const { results, status, loadMore } = usePaginatedQuery(api.requests.listIncoming, {}, { initialNumItems: PAGE_SIZE });
  const decide = useMutation(api.requests.decide);
  const markReturned = useMutation(api.requests.markReturned);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function act(id: Id<"requests">, decision: "approve" | "decline" | "return") {
    if (busy) return;
    setBusy(id);
    setMessage("");
    try {
      if (decision === "return") await markReturned({ id });
      else await decide({ id, decision });
      // The buttons disappear once acted on, so move focus to this request's heading.
      document.getElementById(`request-${id}`)?.focus();
    } catch (error) {
      setMessage(requestMessage(error, "We could not save this. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0) return <Empty text="Nobody has asked to borrow your tools yet." />;
  return (
    <>
      {message && (
        <p role="alert" className="mt-6 font-medium">
          {message}
        </p>
      )}
      <ul className="mt-6 space-y-3">
        {results.map((r) => (
          <li key={r._id} className="rounded-md border border-border bg-surface p-4">
            <h2 id={`request-${r._id}`} tabIndex={-1} className="text-lg font-semibold break-words">
              {r.toolName}
            </h2>
            <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
              <span>
                {r.borrowerName}: {dates(r.startDate, r.endDate)}
              </span>
              <span className={pill}>
                <span className="sr-only">Status: </span>
                {r.status}
              </span>
              <ReminderLine at={r.lastReminderAt} />
            </p>
            {r.status === "pending" && (
              <div className="mt-3 flex gap-2">
                <button type="button" className={primaryButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "approve")}>
                  Approve<span className="sr-only"> {r.toolName}</span>
                </button>
                <button type="button" className={quietButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "decline")}>
                  Decline<span className="sr-only"> {r.toolName}</span>
                </button>
              </div>
            )}
            {r.status === "approved" && (
              <div className="mt-3">
                <button type="button" className={primaryButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "return")}>
                  Mark returned<span className="sr-only"> {r.toolName}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} end="That is every request." />
    </>
  );
}
