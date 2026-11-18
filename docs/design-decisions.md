# Design decisions

Each section records a decision, the reason, and the alternative that was rejected. New sections are added as each part of the app lands.

## App shell

### Route protection is UX only

`src/proxy.ts` redirects signed-out visitors from `/tools`, `/my-listings`, `/my-requests`, `/incoming-requests` (and child paths) to the local `/sign-in`, which sends them back afterwards. It is not the authorization boundary: a visitor can bypass web routes and call Convex directly, so every data function checks the caller itself. A path mismatch in the proxy can therefore only cause a missed redirect, never data exposure.

- **Path check, not Clerk's route matcher.** The installed Clerk version deprecates its route matcher and prints a warning on every run; a small exact-plus-children path check (`isSignedInPath`) avoids the warning. `/toolsx` is correctly not treated as `/tools`.
- **Single source of truth.** The list of signed-in paths is the navigation list in `src/lib/nav.ts`, so adding a page cannot silently skip the redirect as long as it is listed there.
- **Redirect configuration matters.** With an empty `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, Clerk redirects to its hosted portal, and a `*_FORCE_REDIRECT_URL` silently disables return-after-sign-in. `.env.example` pins the local routes and warns about the force variables.
- **Where sign-in returns.** Signing in from a protected page returns to that page. The sign-in button carries the current page as the return address, so signing in from `/` returns to `/`; the `/tools` fallback applies only when no return address exists.

### Waiting for backend authentication (`AuthGate`)

Data regions render inside `src/components/auth-gate.tsx`, which combines Clerk and Convex auth state:

| Clerk | Convex | Shown |
| --- | --- | --- |
| loading | loading | skeleton |
| signed in | authenticated | content |
| signed out | not authenticated | "Sign in to see this page" |
| signed in | not authenticated (after about 10 s) | "We could not load your account data" with a Reload button |

Why a grace period: Convex reports "not authenticated" while Clerk is signed out and does not return to loading when Clerk signs in, so a short "signed in to Clerk, not yet authenticated" window is normal. Showing the error immediately would flash it on every sign-in. If the window lasts, the integration is broken (wrong issuer, or the Clerk Convex integration is off), and the gate says so instead of showing a sign-in prompt that would loop a signed-in user.

Page headings and navigation render outside the gate, so server-rendered HTML is meaningful and only data regions wait for the token.

### Header without layout shift

The header's auth controls use Clerk's client-side `Show` inside a fixed-size slot, so nothing moves while Clerk loads (measured layout shift: 0 signed in and signed out). The server-side `Show` was rejected because it reads the request session, which throws on requests the proxy skips (for example a 404 for `/favicon.ico`) and would turn the branded 404 into a server error.

### Accessibility and layout

- A skip link targets the single `<main>`; on signed-in pages the navigation comes before it, so the link actually skips it.
- Visible focus ring on every control; text contrast is at least 6.6:1 (light) and 8:1 (dark), the focus ring at least 7:1.
- Works from 320 px wide; respects `prefers-reduced-motion` and the system light/dark setting, including Clerk's own sign-in card.
- Each page has its own title (`<Page> · LendLoop`); unknown URLs show a branded not-found page; errors inside signed-in pages show a retry state that re-fetches the server render.

### Out of scope for the shell

No data model, roles, or Convex functions. Those arrive with listings, requests and roles, each stating which Convex function enforces which rule.

## Users and roles

### Profile in Convex, created on first sign-in

A signed-in user gets one profile (`users` table: identity, display name, role), created by the `users.ensureUser` mutation the first time the signed-in app loads and keyed by Clerk's issuer-plus-subject identifier. The mutation takes no input, so a client cannot choose its role or name. A Clerk webhook would also work but needs a public URL and a signing secret; it is a possible later improvement, and it would also handle accounts deleted in Clerk. Moving to a new Clerk instance (for example production) creates new profiles, so admins must be set again there.

### Display names

The name comes from a claim in Clerk's session token (see the setup step in the README); the profile refreshes it whenever the user next opens the app and the name changed. A user without a name is called "Neighbor N", where N comes from a counter that never repeats a number. Email addresses are not stored; a later change adds one only if a feature needs it.

### Roles are enforced in the backend, from the database

The role is read from the stored profile on every call, not from the token, so a demoted admin loses access on their next call. Shared helpers return distinct errors (`NOT_SIGNED_IN`, `PROFILE_MISSING`, `FORBIDDEN`) that describe only the caller. The interface only mirrors these rules.

### Admin is set by hand

There is a single administrator and the brief does not call for a promotion flow, so no code grants admin: the owner edits the `role` field in the Convex dashboard. No public function accepts a role.

### Guarding against a forgotten check

A test loads every deployed Convex module, lists the public functions and compares them with an allowlist kept in the test. A new public function without an entry, without declared arguments, or with a `role` argument fails `npm run check`. The list records the intended check; each function's own tests prove it is applied.

### The gate waits for the profile

The signed-in layout creates and loads the profile once per Clerk session, so page-to-page navigation does not repeat it. Pages show their data only when the profile exists. If creating it fails, the page shows a retry; a returning user whose profile is already loaded is never blocked by a failed name refresh.

### Test tooling

Convex functions are tested with Vitest and `convex-test`. Vitest 4 is used because Vitest 5 needs newer Node type definitions than the project has, and adding it to the project needed `--legacy-peer-deps` once because of an npm resolver bug with its optional peers. The lockfile records the result, so a plain `npm install` works.
