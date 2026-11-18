"use client";

import { useEffect, useRef, useState } from "react";
import { usePaginatedQuery, type PaginationStatus } from "convex/react";
import { catchError, type ErrorInfo } from "next/error";
import { api } from "../../convex/_generated/api";
import { PAGE_SIZE } from "../../convex/lib/paging";
import { CATEGORIES, type Category } from "../../convex/lib/toolOptions";
import { quietButton } from "./button-styles";
import { RequestForm } from "./requests";

export function Loading() {
  return (
    <div aria-hidden="true" className="mt-6 space-y-3">
      <div className="h-16 rounded-md border border-border bg-surface" />
      <div className="h-16 rounded-md border border-border bg-surface" />
    </div>
  );
}

/** One live line that stays mounted, so a change (new filter, next page) is read out. */
function Announce({ status, count, empty }: { status: PaginationStatus; count: number; empty: string }) {
  const text =
    status === "LoadingFirstPage" ? "Loading tools" : count === 0 ? empty : `Showing ${count} ${count === 1 ? "tool" : "tools"}`;
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="mt-6 rounded-md border border-dashed border-border p-6">
      <p className="font-medium">{text}</p>
    </div>
  );
}

/**
 * The "Load more" button, which becomes an end-of-list line. If the button had focus when the last
 * page arrived, focus moves to that line so keyboard users are not dropped on the page body.
 */
export function LoadMore({
  status,
  loadMore,
  end: endText = "That is every tool on the board.",
}: {
  status: PaginationStatus;
  loadMore: () => void;
  end?: string;
}) {
  const end = useRef<HTMLParagraphElement>(null);
  const activated = useRef(false);

  useEffect(() => {
    if (status === "CanLoadMore") activated.current = false;
    if (status === "Exhausted" && activated.current) {
      activated.current = false;
      end.current?.focus();
    }
  }, [status]);

  return (
    <div className="mt-6">
      {status === "Exhausted" ? (
        <p ref={end} tabIndex={-1} className="text-sm text-muted outline-none">
          {endText}
        </p>
      ) : (
        <button
          type="button"
          className={quietButton}
          aria-disabled={status === "LoadingMore"}
          onClick={() => {
            if (status !== "CanLoadMore") return;
            activated.current = true;
            loadMore();
          }}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

export const pill = "rounded-full border border-border px-2";

function PublicList() {
  const { results, status, loadMore } = usePaginatedQuery(api.tools.listPublic, {}, { initialNumItems: PAGE_SIZE });
  const none = "No tools have been listed yet.";
  // A page can be empty while more remain (its tools were on loan), so "empty" means exhausted.
  if (status === "LoadingFirstPage" || (results.length === 0 && status === "Exhausted"))
    return (
      <>
        <Announce status={status} count={results.length} empty={none} />
        {status === "LoadingFirstPage" ? <Loading /> : <Empty text={none} />}
      </>
    );
  return (
    <>
      <Announce status={status} count={results.length} empty={none} />
      {/* Items carry no id, so the index is the key; rows hold no state. */}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {results.map((tool, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-4">
            <span className="min-w-0 font-semibold break-words">{tool.name}</span>
            <span className={`${pill} text-sm text-muted`}>
              <span className="sr-only">Category: </span>
              {tool.category}
            </span>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} />
    </>
  );
}

// usePaginatedQuery throws when the query fails and nothing above `/` catches it, so the list gets
// its own boundary: the tagline and sign-in button stay on the page. The server message is not shown.
function PublicListFailed(_props: object, { error, retry }: ErrorInfo) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mt-6 rounded-md border border-border bg-surface p-6">
      <p className="font-medium">The tool list could not load.</p>
      <button type="button" className={`${quietButton} mt-3`} onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
const PublicListBoundary = catchError(PublicListFailed);

/** Name and category of every tool, for any visitor. */
export function PublicToolList() {
  return (
    <PublicListBoundary>
      <PublicList />
    </PublicListBoundary>
  );
}

/** Every tool for signed-in users, filterable by category. Errors reach the signed-in error page. */
export function AllTools() {
  const [category, setCategory] = useState<Category | "">("");
  const emptyText = category ? `No ${category} tools yet.` : "No tools have been listed yet.";
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.listAll,
    category ? { category } : {},
    { initialNumItems: PAGE_SIZE },
  );
  return (
    <div className="mt-6">
      <label className="block text-sm font-medium">
        Category
        <select
          className="mt-1 block min-h-10 w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category | "")}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <Announce status={status} count={results.length} empty={emptyText} />
      {status === "LoadingFirstPage" ? (
        <Loading />
      ) : results.length === 0 ? (
        <Empty text={emptyText} />
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {results.map((tool) => (
              <li key={tool._id} className="rounded-md border border-border bg-surface p-4">
                <h2 className="text-lg font-semibold break-words">{tool.name}</h2>
                <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                  <span className={pill}>
                    <span className="sr-only">Category: </span>
                    {tool.category}
                  </span>
                  <span className={pill}>
                    <span className="sr-only">Condition: </span>
                    {tool.condition}
                  </span>
                  <span className={pill}>{tool.onLoan ? "On loan today" : "Available"}</span>
                </p>
                <p className="mt-2 break-words">{tool.description}</p>
                <RequestForm toolId={tool._id} toolName={tool.name} />
              </li>
            ))}
          </ul>
          <LoadMore status={status} loadMore={() => loadMore(PAGE_SIZE)} />
        </>
      )}
    </div>
  );
}
