const DAY_MS = 24 * 60 * 60 * 1000;

/** "Reminder sent today / 1 day ago / N days ago", counted in UTC calendar days. Null when there is no reminder. */
export function reminderText(sentAt: number | undefined, now: number): string | null {
  if (sentAt === undefined) return null;
  // A reminder recorded after the page's clock reading (a page left open overnight) still reads as today.
  const days = Math.max(0, Math.floor(now / DAY_MS) - Math.floor(sentAt / DAY_MS));
  if (days === 0) return "Reminder sent today";
  return `Reminder sent ${days} ${days === 1 ? "day" : "days"} ago`;
}
