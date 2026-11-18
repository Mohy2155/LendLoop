export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--primary)" />
      <path
        d="M10.5 11.5h9a4.5 4.5 0 0 1 0 9h-3"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 8.5l-3 3 3 3M18.5 23.5l3-3-3-3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
