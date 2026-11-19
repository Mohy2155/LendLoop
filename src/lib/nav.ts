export type NavItem = {
  label: string;
  href: string;
  /** Shown only to admins. Display only: the proxy and Convex decide access. */
  adminOnly?: boolean;
};

/** Signed-in destinations, in display order. Later changes add entries here. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Tools", href: "/tools" },
  { label: "My listings", href: "/my-listings" },
  { label: "My requests", href: "/my-requests" },
  { label: "Incoming requests", href: "/incoming-requests" },
  { label: "Admin", href: "/admin", adminOnly: true },
];

/** True for a signed-in destination or any child path of one. `/toolsx` does not match `/tools`. */
export function isSignedInPath(pathname: string): boolean {
  return NAV_ITEMS.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
