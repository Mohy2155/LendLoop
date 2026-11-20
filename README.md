# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending board. Neighbors list tools they are happy to lend, ask to borrow from each other for a date range, and get automated notifications and reminders through n8n.

Signed-in neighbors list tools, browse the board, ask to borrow for a date range, approve or decline requests on their own tools and mark loans returned. Admins can remove any listing, see all loans and mark a lender as a Trusted Lender. n8n sends a notification when a request is created or changes status (see [n8n notifications](#n8n-notifications)) and a daily reminder for overdue loans (see [Overdue reminders](#overdue-reminders)).

## Stack

| Concern | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Authentication | Clerk |
| Data and backend logic | Convex |
| Automation | n8n (self-hosted with Docker) |

## Local setup

Requirements: Node.js 20.9 or newer, npm, and Docker (Docker Desktop on Windows) to run n8n.

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

   The first run reports that `CLERK_FRONTEND_API_URL` is missing. Leave it running and do the next step in a second terminal; it deploys once the variable is set.

5. Give the Convex deployment the Clerk issuer (it reads it from its own environment, not from `.env.local`):

   ```bash
   npx convex env set CLERK_FRONTEND_API_URL https://<name>.clerk.accounts.dev
   ```

6. Run the app. Keep `npx convex dev` running in the other terminal, because Convex functions only deploy while it runs:

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

Real values go in `.env.local` (git-ignored). `.env.example` lists the variables that belong there; the Convex and n8n ones are set as the table says.

| Variable | Where it is set | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk keys. The secret key stays server-side and is never exposed to the browser |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `.env.local` | Point Clerk at the local `/sign-in` and `/sign-up` pages instead of its hosted portal |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `.env.local` | Where to land after sign-in when no return address exists (`/tools`). Do not add `*_FORCE_REDIRECT_URL`: it overrides return-after-sign-in |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` (written by `npx convex dev`) | Which Convex deployment the app talks to (the site URL is also the value n8n's `CONVEX_SITE_URL` needs) |
| `CLERK_FRONTEND_API_URL` | Convex deployment env (`npx convex env set`) | Lets Convex verify Clerk-issued tokens. The deploy fails with a clear message if it is missing |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | Convex deployment env (`npx convex env set`) | Where Convex sends the signed notification webhook and the secret it signs with. The same secret verifies the calls n8n makes to the reminder routes. If either is missing the send fails and shows as failed in the Convex dashboard; with no secret the routes answer 401 |
| `LENDLOOP_WEBHOOK_SECRET`, `WEBHOOK_URL` | `n8n/.env` (git-ignored; `n8n/.env.example` has placeholders) | The same secret, used by n8n to verify each call and to sign its own, and n8n's public base URL |
| `CONVEX_SITE_URL` | `n8n/.env` | The `.convex.site` address of your deployment, which the reminder workflow calls (no trailing slash) |

The n8n container also gets fixed settings from `n8n/docker-compose.yml`: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (the signing code reads the secret with `$env` and uses Node's `crypto`), `CODE_ENABLE_STDOUT=true` (so logged messages reach the container log) and `GENERIC_TIMEZONE=UTC`. Because of the first one, anyone who can edit workflows in n8n can read the container's environment.

### Making someone an admin

Everyone starts with the `user` role. There is deliberately no function or screen that grants admin: open the Convex dashboard for your deployment, go to **Data → `users`**, and change that person's `role` to `admin`. They must have signed in once so their row exists. Do this separately for each deployment (development and production).

## n8n notifications

When a borrow request is created, approved, declined or marked returned, Convex sends a signed webhook to n8n, and an n8n workflow writes a logged mock notification for the person concerned (the owner for a new request, the borrower otherwise). The workflow files are in [`n8n/workflows`](n8n/workflows).

1. Copy `n8n/.env.example` to `n8n/.env` and set `LENDLOOP_WEBHOOK_SECRET` to a long random string (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
2. Start n8n and open http://localhost:5678 to create the owner account:

   ```bash
   cd n8n
   docker compose up -d
   ```

3. Import and publish the workflows once (the import needs the owner account to exist, and imported workflows start unpublished). This imports all three workflow files, including the overdue-reminders one described below. Run these from the `n8n` folder. In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` in front of the first command so `/workflows` is not rewritten to a Windows path:

   ```bash
   docker compose exec n8n n8n import:workflow --separate --input=/workflows
   docker compose exec n8n n8n publish:workflow --id=LendLoopRequests
   docker compose exec n8n n8n publish:workflow --id=LendLoopErrors01
   docker compose exec n8n n8n publish:workflow --id=LendLoopReminders
   docker compose restart n8n
   ```

4. From the repository root (not the `n8n` folder, because the Convex CLI reads `.env.local` from there), tell Convex where n8n is and the same secret (Convex cloud cannot reach `localhost`, so `N8N_WEBHOOK_URL` must be a public URL such as a tunnel to port 5678; set `WEBHOOK_URL` in `n8n/.env` to the same base URL and run `docker compose up -d` again in the `n8n` folder, because a restart does not re-read `.env`). A plain tunnel to the whole port also publishes the n8n editor, so use it for testing only and stop it afterwards; production should expose only the `/webhook/` paths.

   ```bash
   npx convex env set N8N_WEBHOOK_URL https://<public-host>/webhook/request-events
   npx convex env set N8N_WEBHOOK_SECRET <the same secret>
   ```

Notifications appear in the n8n **Executions** tab and in the container log (`docker compose logs -f n8n`). A failed run also writes a line from the error handler. To check the workflow without the app, send a signed call yourself: the body is JSON, `x-lendloop-timestamp` is the current time in milliseconds and `x-lendloop-signature` is the lowercase hex HMAC-SHA256 of `<timestamp>.<body>` with the secret.

### Overdue reminders

A second workflow, `overdue-reminders.json`, runs every day at 09:00 UTC. It calls a signed endpoint on your Convex deployment for the overdue loans (approved loans whose end date has passed), writes a logged mock reminder for each borrower, and writes each reminder back to Convex. A loan shows "Reminder sent 2 days ago" in My requests, Incoming requests and the Admin loans list. A loan gets one reminder per day until it is marked returned.

Unlike the notification webhook, n8n calls out to Convex, so no tunnel is needed. To set it up:

1. In `n8n/.env`, set `CONVEX_SITE_URL` to your deployment's `.convex.site` address (the value of `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local`, with no trailing slash), then run `docker compose up -d` again in the `n8n` folder, because a restart does not re-read `.env`.
2. From the repository root, make sure Convex has the same secret n8n has: `npx convex env set N8N_WEBHOOK_SECRET <the same secret>`. The HTTP routes use this variable too.
3. Import and publish the workflow (from the `n8n` folder, with the same Git Bash note as above). On a new install the commands in the section above import all three workflows; publish `LendLoopReminders` as well. On an existing install, import only the new file, because re-importing all of them unpublishes the others:

   ```bash
   docker compose exec n8n n8n import:workflow --input=/workflows/overdue-reminders.json
   docker compose exec n8n n8n publish:workflow --id=LendLoopReminders
   docker compose restart n8n
   ```

Reminders appear in the container log as `[reminder] to <name>: ...`. If a run fails (for example Convex is unreachable), the failing step tries up to three times and then the error workflow logs it. To recover, start a new run; n8n's own Retry button on the failed run is refused once its signature is older than 5 minutes. A new run only lists loans that have no reminder recorded for the day, so loans that already succeeded are not reminded twice. If every call is refused with 401 after your PC wakes from sleep, the Docker clock has drifted: restart Docker Desktop (or run `wsl --shutdown`).

## Architecture

```
Browser ── Next.js (App Router)
            │  proxy.ts: redirects signed-out visitors away from signed-in pages (UX only)
            │  ClerkProvider ─ sign-in / sign-up / session
            └─ ConvexProviderWithClerk ──► Convex (data + functions)
                                           validates the Clerk token, enforces access rules
                                           tables: users, tools, requests, reminders, neighborCounter
                                               │  request created / status changed
                                               ├─ signed webhook ──► n8n (verify, notify, error workflow)
                                               │
                                               └─ HTTP routes /overdue-loans, /reminders
                                                  ◄── n8n daily schedule (signed calls)
```

- **Public pages:** `/` (with a read-only list of tool names and categories), `/sign-in`, `/sign-up`.
- **Signed-in pages** (`src/app/(app)`): `/tools`, `/my-listings`, `/my-requests`, `/incoming-requests` and `/admin` (the Admin link shows for admins only).
- **Navigation** lives in one list, `src/lib/nav.ts`. A new signed-in page is a file under `src/app/(app)/` plus one entry in that list; the layout is not edited.

## Design and security decisions

The reasoning behind each choice is in [`docs/design-decisions.md`](docs/design-decisions.md). The main points:

- **Route protection is a convenience, not the security boundary.** Authorization is enforced inside Convex functions, so calling the backend directly gets no extra access.
- **Auth state is waited for before data is requested.** A gate component distinguishes loading, signed in, signed out, and "signed in to Clerk but the backend rejected the session", so a broken integration is shown as an error and not as a sign-in loop.
- **Users and roles live in Convex.** On first sign-in the app creates a profile (display name and role, plus a Trusted Lender flag once an admin sets it; no email or other contact details). The role is read from the database on every call, never from the sign-in token, so changing it takes effect immediately. Shared checks in `convex/lib/access.ts` (`requireUser`, `requireAdmin`) sit at the start of every protected function.
- **New public functions must declare their access.** A test lists every public Convex function and fails if one is added without an entry, with undeclared arguments, or with a `role` argument.
- **Tools belong to their creator.** Creating, editing and deleting a tool, and listing your own tools, are Convex functions (`convex/tools.ts`) that check who is calling; only the owner can change or delete a tool through these functions (an admin can remove any listing through a separate function, `tools.removeAny`). A user can own at most 50 tools. Category and condition are fixed lists in `convex/lib/toolOptions.ts`.
- **Listings can have up to 3 photos, for signed-in users only.** Only the owner can add or remove them. The server checks the stored file (JPEG, PNG or WebP, at most 5 MB, at most 3 per tool), deletes a rejected file, and deletes a tool's files when the tool is removed. The browser re-draws each photo as a JPEG before uploading it, which drops location and other metadata; this protects uploads made through the app only, because a direct call to the backend can skip it. The public list never carries photos.
- **The public tool list exposes name and category only, and hides tools on loan today.** It is a separate anonymous Convex query (`tools.listPublic`) that builds each item field by field, with no owner, id, condition or description, and its return type is checked at runtime. Paging cursors are opaque tokens issued by Convex. Tool names are text neighbors type and become public, and visitors can see when tools appear or disappear. Signed-in users get a second query (`tools.listAll`) with condition, description and an on-loan flag but still no owner details, and an optional category filter.
- **Lists are paged and bounded.** Both lists page 24 tools at a time, and a single page never reads more than 48 tool rows, whatever paging options a client sends. Both lists also read each listed tool's approved requests to work out "on loan today". The server ignores a client's own row and byte limits, and an end cursor cannot widen a page to every tool.
- **Borrow requests are kept simple.** A request is for one tool and a date range and starts pending; only the tool's owner can approve or decline it (an admin who is not the owner cannot), and each person sees only their own requests. An approved request is the loan, and the Tools list shows whether a tool is on loan today (by the server's UTC date). Only the lender can mark a loan returned, and only once it has started; a returned loan frees the tool. You cannot request your own tool (the rule applies to new requests). Not restricted: overlapping approved requests, cancelling, and deleting a tool that has requests.
- **Admin powers are separate functions, checked in Convex.** An admin can remove any listing (a separate function from the owner's delete, with no extra rule: its requests keep the saved tool name), view all loans (approved and returned requests, with the owner's and borrower's display names) and mark or unmark a user as a Trusted Lender. The Trusted Lender flag is shown on the Admin page only, and no other function returns it. The Admin page and link are display only; a non-admin who opens the page gets no data. The loans list is filtered while paging, so a page can be short or empty while later pages hold loans.
- **The Convex to n8n call is signed, minimal and visible when it fails.** Each webhook carries an HMAC-SHA256 signature over a timestamp and the exact body; n8n verifies it in constant time and rejects calls older or newer than 5 minutes before doing anything. The body holds only the status, tool name, dates and display names (the owner's name only on a new request), never a description, id or email. Convex makes up to three delivery attempts; n8n has an error workflow. Details and accepted limits are in the design decisions.
- **The reminder routes answer only signed calls.** n8n signs each call to Convex with the same HMAC scheme, over the timestamp, method, path and body, so a signature for one route is not valid on the other. The overdue list carries only a request id, tool name, end date and the borrower's name. Reminders are recorded once per loan per day, so a retry never creates a duplicate row or a second reminder. Details are in the design decisions.
- **No secrets in the repository.** Keys live in `.env.local` and in Convex and n8n environment settings; `.env.example` holds names only.

### Data minimization

Each public or outbound surface carries only the fields it needs (paging details aside). Nothing returns an email address, because none is stored.

| Surface | Carries | Deliberately omits |
| --- | --- | --- |
| Anonymous tool list (`tools.listPublic`) | name, category; tools on loan today are hidden | id, owner, condition, description |
| Signed-in tool list (`tools.listAll`) | id, name, category, condition, description, on-loan flag, the link to the first photo | owner details, storage ids |
| Your own tool list (`tools.listMine`) | id, name, category, condition, description, each photo's id and link | owner details |
| Notification webhook to n8n | status, tool name, start and end date, borrower display name; owner display name only on a new request | description, ids, email, role, Trusted Lender flag |
| Overdue list (`GET /overdue-loans`) | the day, and for each loan: request id, tool name, end date, borrower display name | description, user id, email, role, Trusted Lender flag |
| Reminder write-back (`POST /reminders`) | request id, day | everything else |

## Production notes

What would change to run LendLoop in production:

- **Clerk:** use a production instance and domain. The token issuer changes (update `CLERK_FRONTEND_API_URL` on the production Convex deployment), the dashboard settings from Local setup must be repeated, users get new profiles and the admin must be set again. Deleting an account in Clerk does not remove its Convex profile, tools or requests.
- **Convex and the app:** a separate production Convex deployment with its own environment variables (`CLERK_FRONTEND_API_URL`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`) and the functions deployed to it. Host the Next.js app with the production Clerk keys and the production `NEXT_PUBLIC_CONVEX_URL`, and point n8n's `CONVEX_SITE_URL` at the production `.convex.site` address.
- **n8n:** host it at a stable public HTTPS address and expose only the `/webhook/` paths. Keep the editor private and limit it to trusted people, because the workflows read the secret with `$env`, which gives editors access to the container's environment.
- **Secret:** one shared secret signs both directions, so rotating it means changing Convex and n8n together. Calls made in between fail with 401 and Convex does not retry a 401.
- **Replays:** there is no replay store, so a captured signed call can be sent again within its 5 minutes. Reminder write-backs are idempotent, but a repeated notification would be delivered again.
- **Copies of the data:** notification and reminder data (names and dates) also sit in Convex scheduled-function arguments, in n8n execution data and in the container log. Set execution-data pruning in n8n.
- **Rate limiting:** the anonymous tool list and the HTTP routes have none. Both are served by Convex directly (the browser calls the public list on the Convex URL, and n8n calls the routes on the `.convex.site` URL), so the limit has to be added there, not in front of the Next.js app.
- **Photos:** a photo link works for anyone who has it, without signing in, until the photo is deleted; only signed-in users are given links. An upload link has no size or type limit of its own, so the 5 MB and type rules apply to attached photos only; a file that is uploaded but never attached stays in storage, and there is no upload rate limit or cleanup job. The file type is whatever the browser declared. Someone who learned another user's storage id could attach that file to their own listing or reach the delete that follows a rejected upload, and so delete it; ids are random and only sent to the owner.
- **Delivery:** notifications and reminders are logged mock messages. Sending real ones needs a contact address for each person, which the app deliberately does not store, so that changes the data-minimization stance. The error workflow only logs; point it at a real alert channel.
