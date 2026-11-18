# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending board. Neighbors list tools they are happy to lend, ask to borrow from each other for a date range, and get automated notifications and reminders through n8n.

> **Status:** work in progress. The app shell (layout, sign-in, route protection) and user accounts with roles are done. Listings, borrow requests and the n8n workflows are being added one change at a time; the sections below describe what exists today and are extended as each part lands.

## Stack

| Concern | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Authentication | Clerk |
| Data and backend logic | Convex |
| Automation | n8n (self-hosted with Docker), added in a later change |

## Local setup

Requirements: Node.js 20.9 or newer and npm.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a [Clerk](https://clerk.com) application (development instance). Copy `.env.example` to `.env.local` and fill in the Clerk keys.
3. In the Clerk dashboard open **Integrations → Convex** and activate it. Note the **Frontend API URL** it shows (it looks like `https://<name>.clerk.accounts.dev`).
   Then make the user's name available to the backend: under **Sessions → Customize session token** add the claim `"name": "{{user.full_name}}"`, and under **User & authentication** require first and last name at sign-up. Without the claim, users are shown as "Neighbor 1", "Neighbor 2" and so on. Repeat this on a production Clerk instance.
4. Create the Convex dev deployment. This writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` into `.env.local`:

   ```bash
   npx convex dev
   ```

5. Give the Convex deployment the Clerk issuer (it reads it from its own environment, not from `.env.local`):

   ```bash
   npx convex env set CLERK_FRONTEND_API_URL https://<name>.clerk.accounts.dev
   ```

6. Run the app. Keep `npx convex dev` running in a second terminal, because Convex functions only deploy while it runs:

   ```bash
   npm run dev
   ```

Open http://localhost:3000.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm test` | Convex function tests (Vitest with `convex-test`) |
| `npm run check` | `next typegen`, type-check, lint, tests and a production build. Run before every commit |
| `npm run build` / `npm start` | Production build and server |

## Environment variables

Real values go in `.env.local` (git-ignored). `.env.example` lists every variable.

| Variable | Where it is set | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk keys. The secret key stays server-side and is never exposed to the browser |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `.env.local` | Point Clerk at the local `/sign-in` and `/sign-up` pages instead of its hosted portal |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `.env.local` | Where to land after sign-in when no return address exists (`/tools`). Do not add `*_FORCE_REDIRECT_URL`: it overrides return-after-sign-in |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` (written by `npx convex dev`) | Which Convex deployment the app talks to |
| `CLERK_FRONTEND_API_URL` | Convex deployment env (`npx convex env set`) | Lets Convex verify Clerk-issued tokens. The deploy fails with a clear message if it is missing |

### Making someone an admin

Everyone starts with the `user` role. There is deliberately no function or screen that grants admin: open the Convex dashboard for your deployment, go to **Data → `users`**, and change that person's `role` to `admin`. They must have signed in once so their row exists. Do this separately for each deployment (development and production).

## Architecture (so far)

```
Browser ── Next.js (App Router)
            │  proxy.ts: redirects signed-out visitors away from signed-in pages (UX only)
            │  ClerkProvider ─ sign-in / sign-up / session
            └─ ConvexProviderWithClerk ──► Convex (data + functions)
                                           validates the Clerk token, enforces access rules
```

- **Public pages:** `/`, `/sign-in`, `/sign-up`.
- **Signed-in pages** (`src/app/(app)`): `/tools`, `/my-listings`, `/my-requests`, `/incoming-requests`. They currently render labelled placeholders that later changes replace.
- **Navigation** lives in one list, `src/lib/nav.ts`. A new signed-in page is a file under `src/app/(app)/` plus one entry in that list; the layout is not edited.

## Design and security decisions

The reasoning behind each choice is in [`docs/design-decisions.md`](docs/design-decisions.md). The main points so far:

- **Route protection is a convenience, not the security boundary.** Authorization is enforced inside Convex functions, so calling the backend directly gets no extra access.
- **Auth state is waited for before data is requested.** A gate component distinguishes loading, signed in, signed out, and "signed in to Clerk but the backend rejected the session", so a broken integration is shown as an error and not as a sign-in loop.
- **Users and roles live in Convex.** On first sign-in the app creates a profile (display name and role only; no email or other contact details). The role is read from the database on every call, never from the sign-in token, so changing it takes effect immediately. Shared checks in `convex/lib/access.ts` (`requireUser`, `requireAdmin`) sit at the start of every protected function.
- **New public functions must declare their access.** A test lists every public Convex function and fails if one is added without an entry, with undeclared arguments, or with a `role` argument.
- **No secrets in the repository.** Keys live in `.env.local` and in Convex and n8n environment settings; `.env.example` holds names only.

## Production notes

A short note on what would change for production is added when the integration work is complete. Items known already: use Clerk's production instance and domain (token issuer changes with it, so users get new profiles and the admin must be set again), a stable public URL for n8n, and secret rotation for the webhook signing keys.
