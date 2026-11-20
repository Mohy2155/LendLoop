"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PAGE_SIZE } from "../../convex/lib/paging";
import { formatRange } from "../../convex/lib/requestDisplay";
import { quietButton } from "./button-styles";
import { ReminderLine, requestMessage } from "./requests";
import { StatusBadge } from "./status-badge";
import { Empty, Loading, LoadMore, pill } from "./tool-board";

function Loans() {
  const { results, status, loadMore } = usePaginatedQuery(api.admin.listLoans, {}, { initialNumItems: PAGE_SIZE });
  const [now] = useState(() => Date.now()); // read once per mount, so render stays pure
  // A filtered page can be empty while later pages hold loans, so "empty" means every page was read.
  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0 && status === "Exhausted") return <Empty text="There are no loans yet." />;
  return (
    <>
      <ul className="mt-4 space-y-3">
        {results.map((loan) => (
          <li key={loan._id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 text-lg font-semibold break-words">{loan.toolName}</h3>
              <StatusBadge status={loan.status} endDate={loan.endDate} now={now} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Lender</dt>
              <dd className="break-words">{loan.ownerName}</dd>
              <dt className="text-muted">Borrower</dt>
              <dd className="break-words">{loan.borrowerName}</dd>
              <dt className="text-muted">Dates</dt>
              <dd>{formatRange(loan.startDate, loan.endDate, now)}</dd>
            </dl>
            <p className="mt-2 text-sm text-muted empty:hidden">
              <ReminderLine at={loan.lastReminderAt} />
            </p>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} end="That is every loan." />
    </>
  );
}

function Users() {
  const { results, status, loadMore } = usePaginatedQuery(api.admin.listUsers, {}, { initialNumItems: PAGE_SIZE });
  const setTrusted = useMutation(api.admin.setTrusted);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function toggle(id: Id<"users">, trusted: boolean) {
    if (busy) return;
    setBusy(id);
    setMessage("");
    try {
      await setTrusted({ id, trusted });
    } catch (error) {
      setMessage(requestMessage(error, "We could not save this. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0) return <Empty text="There are no users yet." />;
  return (
    <>
      {message && (
        <p role="alert" className="mt-4 font-medium text-danger">
          {message}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {results.map((user) => (
          <li key={user._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-4">
            <span className="min-w-0 font-semibold break-words">
              {user.displayName}
              {user.trusted && <span className={`${pill} ml-2 text-sm font-normal text-muted`}>Trusted Lender</span>}
            </span>
            <button type="button" className={quietButton} aria-disabled={busy === user._id} onClick={() => toggle(user._id, !user.trusted)}>
              {user.trusted ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
              <span className="sr-only"> for {user.displayName}</span>
            </button>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} end="That is every user." />
    </>
  );
}

/** All loans and the Trusted Lender toggle. Errors (including a non-admin caller) reach the signed-in error page. */
export function AdminPanel() {
  return (
    <>
      <section aria-labelledby="loans-heading" className="mt-8">
        <h2 id="loans-heading" className="text-xl font-semibold">
          All loans
        </h2>
        <Loans />
      </section>
      <section aria-labelledby="users-heading" className="mt-10">
        <h2 id="users-heading" className="text-xl font-semibold">
          Trusted Lenders
        </h2>
        <Users />
      </section>
    </>
  );
}
