# Design decisions

Each section records a decision, the reason, and the alternative that was rejected. New sections are added as each part of the app lands.

## App shell

### Route protection is UX only

`src/proxy.ts` redirects signed-out visitors from `/tools`, `/my-listings`, `/my-requests`, `/incoming-requests`, `/admin` (and child paths) to the local `/sign-in`, which sends them back afterwards. It is not the authorization boundary: a visitor can bypass web routes and call Convex directly, so every data function checks the caller itself. A path mismatch in the proxy can therefore only cause a missed redirect, never data exposure.

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
- Each page has its own title (`<Page> · LendLoop`); unknown URLs show a branded not-found page; errors inside signed-in pages, including a failing My listings query, show a retry state that re-fetches the server render.

### Out of scope for the shell

No data model, roles, or Convex functions. Those arrive with listings, requests and roles, each stating which Convex function enforces which rule.

## Users and roles

### Profile in Convex, created on first sign-in

A signed-in user gets one profile (`users` table: identity, display name, role, and a Trusted Lender flag once an admin sets it), created by the `users.ensureUser` mutation the first time the signed-in app loads and keyed by Clerk's issuer-plus-subject identifier. The mutation takes no input, so a client cannot choose its role or name. A Clerk webhook would also work but needs a public URL and a signing secret; it is a possible later improvement, and it would also handle accounts deleted in Clerk. Moving to a new Clerk instance (for example production) creates new profiles, so admins must be set again there.

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

## Tools

### Fields and fixed lists

A tool has a name, a category, a condition, a description and one owner (the user who created it). Category (Power tools, Hand tools, Garden, Ladders and access, Cleaning, Other) and condition (New, Good, Fair, Worn) are fixed lists, so the category filter added later stays clean instead of filling with near-duplicates like "Drill" and "drills". The lists, the text limits (name 1 to 60, description 1 to 300 characters after trimming, each containing at least one letter or digit so invisible characters or punctuation alone cannot make a blank-looking name) and the per-user cap live in `convex/lib/toolOptions.ts`, shared by the schema, the functions and the form. The values are stored as their labels. Adding a value is a one-line change; renaming or removing one needs a data migration, because Convex checks stored documents against the schema.

### Ownership, enforced in the backend

`tools.create`, `tools.update`, `tools.remove` and `tools.listMine` all require a signed-in user with a profile and none accepts an owner or a role: the owner is always the caller. Only the owner can edit or delete a tool; a missing tool gives "not found" and someone else's gives "forbidden", and the admin role does not widen these functions (an admin removes a listing through the separate `tools.removeAny`, described under Admin). Checks run in a fixed order: argument validators, then the sign-in check, then the tool lookup and owner check, then the text checks, then the cap, so a signed-out caller with well-formed arguments learns only that they are signed out. The page only mirrors these rules for usability.

### Permanent delete, and a cap

Deleting a tool removes it. A tool is removed whether or not it has requests; its requests keep the saved tool name. One user can own at most 50 tools, so a single account cannot flood the board; a later list across all users still has to be bounded or paginated.

### Error codes

Failures use `NOT_SIGNED_IN`, `PROFILE_MISSING`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `LIMIT_REACHED`, `NOT_PENDING`, `NOT_APPROVED` and `NOT_STARTED`. They describe only the caller's request, never other users' data. Argument-validator failures (a value outside a list, an id from another table) are plain errors with no code, so the interface falls back to a generic message for them.

### The My listings page

One form serves adding and editing, and only one form is open at a time. A save in progress cannot be submitted again, which matters because Convex replays an in-flight call after a dropped connection. If a tool is deleted in another tab while it is being edited, the form stays open with a notice instead of vanishing, and saving is blocked. Focus returns to the control that opened a form or confirmation (cancelling a delete goes back to that row's Delete button), or to "Add a tool" if the focused row disappears, and a polite status line announces additions, saves and deletions.

### The tool board

Two queries read the whole board. `tools.listPublic` is open to anyone, including a signed-in user who has no profile yet, and returns exactly name and category; it declares that return shape so a field added to `tools` later cannot leak through it by accident. `tools.listAll` requires a signed-in user with a profile, returns id, name, category, condition and description, and takes an optional category. Neither returns owner details. They are separate functions so the public one contains no authorization branch.

Both page newest first, 24 to a page. The client sends the whole paging options object, so the server rebuilds it: the page size is forced into 1 to 24 (NaN, zero and negatives included) and tool rows read per page are fixed at 48 (the client's own row and byte limits are discarded, since 0 or NaN would switch a cap off), because an end cursor from the client would otherwise make one page span every tool. When the cap is hit, Convex asks the client to split the page, which the paging hook does itself. The category filter uses the `by_category` index so filtered pages are full; filtering after loading would give short or empty pages.

Public rows have no id, so the list uses its position as the key; rows hold no state. A failing public query is caught by its own boundary on the home page, so the tagline and sign-in button stay; the server's message is never shown. "Load more" stays a button (disabled with `aria-disabled` while loading) and becomes an end-of-list line that takes focus if the button was used to load the last page, and one polite status line that stays on the page announces how many tools are shown, including after a category change. The public list hides tools that are on loan today; because that is checked after paging, a page can be shorter than 24, or empty while more remain.

## Borrow requests

One `requests` table holds every request: tool, a copy of the tool's name (so it still reads if the tool is deleted), owner, borrower, start and end date (`YYYY-MM-DD` text) and a status of pending, approved, declined or returned. An approved or returned request is a loan.

`requests.create` takes only a tool and two dates; the borrower and owner are taken from the caller and the tool, never from the client. The only date rule is a real calendar range with the end not before the start. `requests.decide` takes a request id and approve or decline, and works only for the request's owner while it is pending, whatever the caller's role. The two lists (`listMine`, `listIncoming`) return only the caller's own requests, with no other-party identifiers; the owner's list shows the borrower's display name so they know who is asking.

The signed-in tool list reports whether a tool is on loan today: an approved request whose dates include today's UTC date. It is not refreshed until the query re-runs, and people far from UTC can see it a day early or late.

`requests.markReturned` takes only the request id and works only for the request's owner, whatever their role, on an approved loan that has already started (start date not after today, UTC), so a future loan cannot be marked returned. A returned loan no longer counts as on loan.

Deliberately not handled, since the brief does not ask for it: overlapping approved requests, cancelling a request, requesting your own tool, limits on how many requests someone can make, and deleting a tool that has requests.

## Admin

Admin powers are separate Convex functions that all start with the admin check, so the owner-only functions keep their rules. `tools.removeAny` deletes any listing with no extra rule: a tool with requests or loans is removed like any other, and its requests keep their saved tool name. `admin.listLoans` returns every approved or returned request with the tool name, dates, status and the owner's and borrower's display names ("Unknown neighbor" if a user is gone), and nothing else. Display names are shown so the admin can tell who lent to whom. `admin.listUsers` and `admin.setTrusted` list users (id, display name, flag) and set or clear the Trusted Lender flag, which changes no other field. The flag is stored as an optional field on the profile, so users without it are not trusted, and it is shown on the Admin page only: no other function returns it.

The Admin link is hidden unless the viewer is an admin and never grants access; the page's data comes only from the admin functions, so a non-admin who opens it gets an error and no data. The navigation reads the role itself because it sits outside the profile provider, and a failed read just hides the link.

The loans list filters by status while paging, so a page can be short or empty while later pages hold loans; the page shows "no loans" only after every page has been read.

## Request notifications

Creating a request and each status change (approved, declined, returned) schedules one webhook call to n8n from inside the same Convex mutation. Because it is scheduled in the mutation's transaction, a refused action sends nothing, and because a separate action does the sending, a slow or broken n8n never changes what the user sees. The scheduling lives in `convex/lib/notify.ts` and the sending in `convex/notify.ts`.

**What is sent.** The status, tool name, start and end dates and the borrower's display name, plus the owner's display name only on a new request (the owner is the person addressed). Borrower-facing messages never name the owner, because the app hides the owner from borrowers. No description, ids, emails, role or Trusted Lender flag are sent. The payload is built field by field from named fields. A display name is not a unique recipient, so the logged mock addresses people by name only; a real channel would need a recipient address, which the brief does not ask for.

**Signature.** The body is serialized once, and `HMAC-SHA256(secret, timestamp + "." + body)` (hex) is sent as `x-lendloop-signature` with the timestamp in `x-lendloop-timestamp`. n8n hashes the raw bytes it received (not re-serialized JSON), compares in constant time, and answers 401 for a missing, malformed or wrong signature, a non-numeric timestamp, or a timestamp more than 5 minutes in the past or future. The check never throws: any exception, an empty or multipart body or a missing or empty secret also gives 401, so junk requests cannot fill the error log. Forged calls need the secret; changing a captured body breaks the signature; a replay inside the 5-minute window is possible and accepted, because the only effect is a repeated mock notification. There is no nonce store.

**Secrets.** The secret exists only in the Convex deployment env, in `n8n/.env` (git-ignored) and in the n8n container's environment. The exported workflows contain only the variable name, no credentials block and no saved test data. n8n reads it with `$env`, which requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`; that exposes the container's environment to Code nodes, so only people you trust should edit workflows on this instance. The webhook path is in the repository and is not secret: the signature is the protection.

**Failures.** Convex makes up to three attempts (10 seconds, then 60 seconds apart) when n8n is unreachable or answers 5xx or 429, signing each attempt with a fresh timestamp. Any other 4xx (for example 401 from a wrong secret) is a configuration problem and is not retried. A missing URL or secret, or a last failed attempt, ends the scheduled run as failed, visible in the Convex dashboard. In n8n n8n tries the notification step up to three times and the workflow's error workflow logs the workflow name, execution id and message. n8n answers 200 as soon as the signature is verified, so a later failure inside n8n is reported once by the error workflow and does not make Convex resend. If n8n processed a call but the reply was lost, a retry can send the same notification twice; accepted, since nothing is written back and the brief's idempotency rule applies to write-backs.

**Where the data sits.** The payload (names and dates) is also stored in Convex's scheduled-function arguments in n8n's saved execution data and, for the logged mock notification, in the container log; they follow those systems' retention settings.

**Running n8n.** `n8n/docker-compose.yml` pins an exact n8n version. Importing the workflows is a one-time step after the owner account exists, because the import needs an owner, leaves workflows unpublished, and would overwrite later edits if repeated on every start. All three workflows must be published, including the error workflow, or its trigger never fires. All have fixed ids so the error-workflow setting survives the import. Convex cloud cannot reach `localhost`, so a real end-to-end run needs a public URL for n8n; expose only the `/webhook/` paths so the editor stays private.

## Overdue reminders

A daily n8n workflow fetches the overdue loans from Convex, writes a logged mock reminder for each borrower and writes the result back. The routes are in `convex/http.ts`, the reads and writes in `convex/reminders.ts` and the signature check in `convex/lib/signedRequest.ts`.

**What overdue means.** An approved request whose end date is before today's UTC date. A loan that ends today is not overdue until tomorrow. Pending, declined and returned requests are never listed, so marking a loan returned ends its reminders. The list is read through an index on status and end date.

**One reminder per loan per day.** The workflow runs daily, so a borrower is reminded every day until the loan is returned. A reminder is one row keyed by the loan and the day. The list leaves out loans that already have a row for that day, so a second run on the same day lists nothing already done. The day comes from the fetch and is echoed in the write-back, so a retry, even across midnight, hits the same row. The write-back looks the pair up and inserts only if it is absent; Convex transactions are serializable and the lookup goes through the index, so two concurrent write-backs cannot both insert. A write-back for an unknown or malformed request id, a bad day or bad JSON is refused with 400 and writes nothing; any other failure answers an empty 500, so a real fault is never reported as bad input.

**Signing in this direction.** n8n sends `x-lendloop-timestamp` and `x-lendloop-signature`, the hex HMAC-SHA256 of `timestamp.METHOD.path.body` (the body is empty for the GET), using the same shared secret as the webhook (`N8N_WEBHOOK_SECRET` in Convex, `LENDLOOP_WEBHOOK_SECRET` in n8n). The method and path are part of the signed text, so a signature captured on one route is not valid on the other, and a webhook signature cannot match either form. Each route signs a fixed path, and n8n signs the exact body string it sends. Verification is constant time, rejects timestamps more than 5 minutes old or in the future, treats a missing or empty secret as a failure before any key is imported, and answers 401 with an empty body, so a refused call learns nothing. A replayed GET inside the window only repeats a read of the same minimal data; a replayed write-back changes nothing. In the other direction, a signed string sent to the n8n webhook as its body would pass the signature check there, but it is not JSON, so the verify step answers 401. There is no nonce store.

**Data minimization.** The list carries the request id (the write-back key), tool name, end date and the borrower's display name ("Unknown neighbor" if the user is gone). It never carries a description, user id, email, role or Trusted Lender flag. The write-back body is the request id and the day. In the app, loans show only when a reminder was recorded, as a day count; no other reminder data is returned and the existing access checks (own requests, own tools, admin) apply unchanged.

**Failures and accepted limits.** Both HTTP steps try up to three times and the workflow uses the same error workflow as the notifications, which logs the workflow name, execution id and message. The error workflow only fires for published, scheduled runs, not manual test runs. If a reminder is logged but its write-back never succeeds, the recovery is a new run on the same day, which lists that loan again and reminds the borrower a second time; n8n's Retry on the failed run cannot finish because its saved signature is older than 5 minutes. This follows the order the work is described in (send the reminder, then write the status back). Two overlapping runs can also send two reminders, though only one row is written. The overdue query reads every overdue loan in one call, which is fine for a neighborhood and is noted in the code.

**Running it.** n8n calls out to Convex, so no tunnel is needed. A full re-import of the workflow files unpublishes the ones already running, so an existing install imports only the new file and publishes it. The Convex site URL is the only new n8n setting. The day count in the app uses UTC calendar days between the recorded time and now.
