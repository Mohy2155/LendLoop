"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PAGE_SIZE } from "../../convex/lib/paging";
import { reminderText } from "../../convex/lib/reminderText";
import { formatRange } from "../../convex/lib/requestDisplay";
import { dangerOutlineButton, primaryButton, quietButton } from "./button-styles";
import { StatusBadge } from "./status-badge";
import { Empty, Loading, LoadMore } from "./tool-board";

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
      return "This reservation is no longer active.";
    case "NOT_CANCELLABLE":
      return "This request can't be cancelled now.";
    case "NOT_PICKED_UP":
      return "This tool isn't out on loan, so it can't be marked returned.";
    case "INVALID_INPUT":
      return "Choose a start and an end date, with the end on or after the start.";
    case "START_IN_PAST":
      return "The start date can't be in the past.";
    case "ALREADY_REQUESTED":
      return "You've already requested this tool.";
    case "ON_LOAN":
      return "This tool is on loan right now.";
    case "RESERVED":
      return "Another request is reserved. Cancel it to approve this one.";
    case "OWN_TOOL":
      return "This is your own tool, so you cannot borrow it.";
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

const label = "text-muted";
const dateField = "mt-1 block min-h-10 rounded-md border bg-surface px-3 py-2";

/**
 * "Request to borrow" for one tool: a start and an end date. `onSending` tells the tool card a request is going out
 * (true before it is sent, false if it fails): the card swaps this form for "You've already requested this tool"
 * once it goes through, so the form cannot move focus itself.
 */
export function RequestForm({ toolId, toolName, onSending }: { toolId: Id<"tools">; toolName: string; onSending: (sending: boolean) => void }) {
  const create = useMutation(api.requests.create);
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(""); // the UTC day, read when the form opens (the server uses the same day)
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [badDates, setBadDates] = useState(false); // only a date problem outlines the date fields
  const uid = useId();
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
      <button
        ref={trigger}
        type="button"
        className={quietButton}
        onClick={() => {
          setToday(new Date().toISOString().slice(0, 10));
          setOpen(true);
        }}
      >
        Request to borrow<span className="sr-only"> {toolName}</span>
      </button>
    );

  return (
    <form
      className="flex basis-full flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        setBadDates(false);
        try {
          onSending(true);
          await create({ toolId, startDate: start, endDate: end });
          setStart("");
          setEnd("");
        } catch (error) {
          onSending(false);
          setMessage(requestMessage(error, "We could not send this request. Try again."));
          setBadDates(error instanceof ConvexError && (error.data as { code?: string })?.code === "INVALID_INPUT");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p id={`${uid}-hint`} className={`basis-full text-sm ${label}`}>
        Choose the first and last day you need it. One day is fine.
      </p>
      <label className="text-sm font-medium">
        Start
        <input type="date" required min={today} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={badDates || undefined} aria-describedby={`${uid}-hint${badDates ? ` ${uid}-error` : ""}`} className={`${dateField} ${badDates ? "border-danger" : "border-border"}`} />
      </label>
      <label className="text-sm font-medium">
        End
        <input type="date" required min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={badDates || undefined} aria-describedby={`${uid}-hint${badDates ? ` ${uid}-error` : ""}`} className={`${dateField} ${badDates ? "border-danger" : "border-border"}`} />
      </label>
      <button type="submit" className={primaryButton} aria-disabled={busy}>
        Send request
      </button>
      <button type="button" className={quietButton} onClick={close}>
        Cancel
      </button>
      {message && (
        <p id={`${uid}-error`} role="alert" className="basis-full text-sm font-medium text-danger">
          {message}
        </p>
      )}
    </form>
  );
}

/** The requests the caller has made, with Cancel request (pending or approved) and I received it (approved). */
export function MyRequests() {
  const { results, status, loadMore } = usePaginatedQuery(api.requests.listMine, {}, { initialNumItems: PAGE_SIZE });
  const cancel = useMutation(api.requests.cancel);
  const confirmPickup = useMutation(api.requests.confirmPickup);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [now] = useState(() => Date.now()); // read once per mount, so render stays pure

  async function act(id: Id<"requests">, action: "cancel" | "pickup") {
    if (busy) return;
    setBusy(id);
    setMessage("");
    try {
      if (action === "cancel") await cancel({ id });
      else await confirmPickup({ id });
      // The buttons disappear once acted on, so move focus to this request's heading.
      document.getElementById(`my-request-${id}`)?.focus();
    } catch (error) {
      setMessage(requestMessage(error, "We could not save this. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0) return <Empty text="You have not asked to borrow anything yet." />;
  return (
    <>
      {message && (
        <p role="alert" className="mt-6 font-medium text-danger">
          {message}
        </p>
      )}
      <ul className="mt-6 space-y-3">
        {results.map((r) => (
          <li key={r._id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id={`my-request-${r._id}`} tabIndex={-1} className="min-w-0 text-lg font-semibold break-words">
                {r.toolName}
              </h2>
              <StatusBadge status={r.status} endDate={r.endDate} now={now} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className={label}>Dates</dt>
              <dd>{formatRange(r.startDate, r.endDate, now)}</dd>
            </dl>
            <p className="mt-2 text-sm text-muted empty:hidden">
              <ReminderLine at={r.lastReminderAt} />
            </p>
            {(r.status === "pending" || r.status === "approved") && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status === "approved" && (
                  <button type="button" className={primaryButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "pickup")}>
                    I received it<span className="sr-only"> {r.toolName}</span>
                  </button>
                )}
                <button type="button" className={quietButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "cancel")}>
                  Cancel request<span className="sr-only"> {r.toolName}</span>
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

/** Requests for the caller's tools: Approve and Decline on pending ones, Cancel reservation on approved, Mark returned once picked up. */
export function IncomingRequests() {
  const { results, status, loadMore } = usePaginatedQuery(api.requests.listIncoming, {}, { initialNumItems: PAGE_SIZE });
  const decide = useMutation(api.requests.decide);
  const cancel = useMutation(api.requests.cancel);
  const markReturned = useMutation(api.requests.markReturned);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [now] = useState(() => Date.now()); // read once per mount, so render stays pure

  async function act(id: Id<"requests">, action: "approve" | "decline" | "cancel" | "return") {
    if (busy) return;
    setBusy(id);
    setMessage("");
    try {
      if (action === "return") await markReturned({ id });
      else if (action === "cancel") await cancel({ id });
      else await decide({ id, decision: action });
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
        <p role="alert" className="mt-6 font-medium text-danger">
          {message}
        </p>
      )}
      <ul className="mt-6 space-y-3">
        {results.map((r) => (
          <li key={r._id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id={`request-${r._id}`} tabIndex={-1} className="min-w-0 text-lg font-semibold break-words">
                {r.toolName}
              </h2>
              <StatusBadge status={r.status} endDate={r.endDate} now={now} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className={label}>Borrower</dt>
              <dd className="break-words">{r.borrowerName}</dd>
              <dt className={label}>Dates</dt>
              <dd>{formatRange(r.startDate, r.endDate, now)}</dd>
            </dl>
            <p className="mt-2 text-sm text-muted empty:hidden">
              <ReminderLine at={r.lastReminderAt} />
            </p>
            {r.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.blocked ? (
                  <p className="basis-full text-sm text-muted">
                    {r.blocked === "onLoan"
                      ? "This tool is on loan. You can approve after it's returned."
                      : "Another request is reserved. Cancel it to approve this one."}
                  </p>
                ) : (
                  <button type="button" className={primaryButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "approve")}>
                    Approve<span className="sr-only"> {r.toolName}</span>
                  </button>
                )}
                <button type="button" className={dangerOutlineButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "decline")}>
                  Decline<span className="sr-only"> {r.toolName}</span>
                </button>
              </div>
            )}
            {r.status === "approved" && (
              <div className="mt-3">
                <button type="button" className={quietButton} aria-disabled={busy === r._id} onClick={() => act(r._id, "cancel")}>
                  Cancel reservation<span className="sr-only"> {r.toolName}</span>
                </button>
              </div>
            )}
            {r.status === "pickedUp" && (
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
