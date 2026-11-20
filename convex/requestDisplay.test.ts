import { describe, expect, test } from "vitest";
import { formatRange, isOverdue } from "./lib/requestDisplay";

const NBSP = "\u00a0";
const now = Date.UTC(2026, 10, 20, 15); // 2026-11-20

describe("isOverdue", () => {
  test("an approved or picked-up loan that ended before today is overdue", () => {
    for (const status of ["approved", "pickedUp"]) {
      expect(isOverdue(status, "2026-11-19", now)).toBe(true);
      expect(isOverdue(status, "2026-11-20", now)).toBe(false);
      expect(isOverdue(status, "2026-12-01", now)).toBe(false);
    }
  });
  test("other statuses are never overdue", () => {
    for (const status of ["pending", "declined", "cancelled", "returned"]) expect(isOverdue(status, "2026-01-01", now)).toBe(false);
  });
  test("uses the UTC day", () => {
    expect(isOverdue("approved", "2026-11-19", Date.UTC(2026, 10, 20, 0, 0, 1))).toBe(true);
    expect(isOverdue("approved", "2026-11-19", Date.UTC(2026, 10, 19, 23, 59, 59))).toBe(false);
  });
});

describe("formatRange", () => {
  test("same month and year share the month", () => {
    expect(formatRange("2026-11-08", "2026-11-12", now)).toBe(`8 to 12${NBSP}Nov`);
  });
  test("a month change", () => {
    expect(formatRange("2026-10-28", "2026-11-02", now)).toBe(`28${NBSP}Oct to 2${NBSP}Nov`);
  });
  test("same month in different years does not collapse", () => {
    expect(formatRange("2025-11-08", "2026-11-12", now)).toBe(`8${NBSP}Nov${NBSP}2025 to 12${NBSP}Nov`);
  });
  test("a one-day range shows one date", () => {
    expect(formatRange("2026-11-08", "2026-11-08", now)).toBe(`8${NBSP}Nov`);
  });
  test("the year is added to each date outside the current year", () => {
    expect(formatRange("2025-11-08", "2025-11-12", now)).toBe(`8 to 12${NBSP}Nov${NBSP}2025`);
    expect(formatRange("2026-12-28", "2027-01-03", now)).toBe(`28${NBSP}Dec to 3${NBSP}Jan${NBSP}2027`);
  });
  test("a single day in another year", () => {
    expect(formatRange("2025-03-01", "2025-03-01", now)).toBe(`1${NBSP}Mar${NBSP}2025`);
  });
});
