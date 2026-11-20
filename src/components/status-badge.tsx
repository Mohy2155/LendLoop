import { isOverdue } from "../../convex/lib/requestDisplay";

const STYLE: Record<string, string> = {
  pending: "bg-neutral-soft text-neutral-fg",
  approved: "bg-success-soft text-success-fg",
  declined: "bg-danger-soft text-danger-soft-fg",
  returned: "border border-border text-muted",
};

const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium capitalize";

/** The request's status in its own color (the word is always shown), plus "Overdue" for a late loan. */
export function StatusBadge({ status, endDate, now }: { status: string; endDate: string; now: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`${badge} ${STYLE[status] ?? STYLE.pending}`}>
        <span className="sr-only">Status: </span>
        {status}
      </span>
      {isOverdue(status, endDate, now) && <span className={`${badge} bg-warning-soft text-warning-fg`}>Overdue</span>}
    </span>
  );
}
