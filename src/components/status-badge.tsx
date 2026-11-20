import { isOverdue } from "../../convex/lib/requestDisplay";

const STYLE: Record<string, string> = {
  pending: "bg-neutral-soft text-neutral-fg",
  approved: "bg-success-soft text-success-fg",
  pickedUp: "bg-primary text-primary-foreground",
  declined: "bg-danger-soft text-danger-soft-fg",
  returned: "border border-border text-muted",
  cancelled: "border border-dashed border-border text-muted",
};

// The raw value would read "PickedUp", and CSS capitalizing would turn "Picked up" into "Picked Up".
const LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  pickedUp: "Picked up",
  declined: "Declined",
  returned: "Returned",
  cancelled: "Cancelled",
};

const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium";

/** The request's status in its own style (the word is always shown), plus "Overdue" for a late loan. */
export function StatusBadge({ status, endDate, now }: { status: string; endDate: string; now: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`${badge} ${STYLE[status] ?? STYLE.pending}`}>
        <span className="sr-only">Status: </span>
        {LABEL[status] ?? status}
      </span>
      {isOverdue(status, endDate, now) && <span className={`${badge} bg-warning-soft text-warning-fg`}>Overdue</span>}
    </span>
  );
}
