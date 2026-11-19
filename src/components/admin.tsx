"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PAGE_SIZE } from "../../convex/lib/paging";
import { quietButton } from "./button-styles";
import { requestMessage } from "./requests";
import { Empty, Loading, LoadMore, pill } from "./tool-board";

function Loans() {
  const { results, status, loadMore } = usePaginatedQuery(api.admin.listLoans, {}, { initialNumItems: PAGE_SIZE });
  // A filtered page can be empty while later pages hold loans, so "empty" means every page was read.
  if (status === "LoadingFirstPage") return <Loading />;
  if (results.length === 0 && status === "Exhausted") return <Empty text="There are no loans yet." />;
  return (
    <>
      <ul className="mt-4 space-y-3">
        {results.map((loan) => (
          <li key={loan._id} className="rounded-md border border-border bg-surface p-4">
            <h3 className="text-lg font-semibold break-words">{loan.toolName}</h3>
            <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
              <span>
                {loan.ownerName} to {loan.borrowerName}: {loan.startDate === loan.endDate ? loan.startDate : `${loan.startDate} to ${loan.endDate}`}
              </span>
              <span className={pill}>
                <span className="sr-only">Status: </span>
                {loan.status}
              </span>
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
        <p role="alert" className="mt-4 font-medium">
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
