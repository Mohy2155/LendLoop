import type { PaginationOptions } from "convex/server";

export const PAGE_SIZE = 24;
export const MAX_ROWS_READ = 48;

/**
 * The client sends the whole options object, so rebuild it: a safe page size and a fixed rows-read
 * limit. The client's own row and byte limits are dropped (0 or NaN would switch the cap off; the
 * paging hook never sends them). An end cursor cannot widen a page past the cap either: Convex asks
 * the client hook to split a page that hits it.
 */
export function safePaging(opts: PaginationOptions): PaginationOptions {
  const { numItems, cursor, endCursor } = opts;
  const size = Number.isFinite(numItems) ? Math.floor(numItems) : PAGE_SIZE;
  return { numItems: Math.min(PAGE_SIZE, Math.max(1, size)), cursor, endCursor, maximumRowsRead: MAX_ROWS_READ };
}
