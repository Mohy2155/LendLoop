/** An approved loan whose end date is before today (UTC): the same rule the daily reminders use. */
export function isOverdue(status: string, endDate: string, now: number) {
  return status === "approved" && endDate < new Date(now).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NBSP = "\u00a0";

/** "8 to 12 Nov": dates never split across lines, and a year is added to each date outside the current UTC year. */
export function formatRange(start: string, end: string, now: number) {
  const thisYear = new Date(now).getUTCFullYear();
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const date = (y: number, m: number, d: number) => [d, MONTHS[m - 1], ...(y === thisYear ? [] : [y])].join(NBSP);
  if (start === end) return date(sy, sm, sd);
  if (sy === ey && sm === em) return `${sd} to ${date(ey, em, ed)}`;
  return `${date(sy, sm, sd)} to ${date(ey, em, ed)}`;
}
