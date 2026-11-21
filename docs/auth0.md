# Sign-in with Auth0

Auth0 is OVR's identity layer. A student signs in with Auth0 (Universal Login: email and password,
or Google if you turn it on), and from then on the server knows **which learner is asking** from a
verified session, not from anything the browser sends. Everything already keyed by learner (librarian
requests, saved sources, study plans, notes, XP and progress) becomes per-account, and private
features (personal libraries, Study Circles) can check ownership and membership on the server.

Sign-in is optional. Until the keys are filled in, OVR works exactly as before: each browser is an
anonymous learner (a signed cookie), sign-in buttons say "Sign-in isn't set up yet", and private
endpoints answer `503 auth_not_configured`.

## Set it up (about 5 minutes)

1. **Create an Auth0 account** at [auth0.com](https://auth0.com) (the free plan is enough) and open
   the dashboard for your tenant.
2. **Applications → Applications → Create Application.** Name it `OVR`, choose **Regular Web
   Applications**, then **Create**. (Not "Single Page Application": OVR signs in on the server.)
3. On the app's **Settings** tab, under **Application URIs**, set:
   - **Allowed Callback URLs**: `http://localhost:3100/auth/callback`
   - **Allowed Logout URLs**: `http://localhost:3100`
   - **Allowed Web Origins**: `http://localhost:3100`

   Then **Save Changes** at the bottom of the page.

4. Still on **Settings**, under **Basic Information**, copy three values into `apps/web/.env.local`:

   ```bash
   AUTH0_DOMAIN=your-tenant.us.auth0.com   # "Domain", without https://
   AUTH0_CLIENT_ID=...                      # "Client ID"
   AUTH0_CLIENT_SECRET=...                  # "Client Secret" (click the eye to show it)
   ```

   `AUTH0_SECRET` (encrypts the session cookie; make one with `openssl rand -hex 32`),
   `EMAIL_HASH_SECRET` (keys the email hash below; optional, one is derived from `AUTH0_SECRET`
   without it) and `APP_BASE_URL=http://localhost:3100` are already there. Keep `.env.local` out of
   git and never put these values in client code or a `NEXT_PUBLIC_` variable.

5. **Restart the dev server** (the keys are read at request time, and `next dev` also reloads
   `.env.local` when it changes, but a restart is the sure way).
6. Optional: **Authentication → Social → Google** for "Continue with Google". Sign-up is on by
   default for the Username-Password database (Authentication → Database).

Check it: the header shows **Sign in**. Sign in, and the header and the title screen's member card
say "Signed in as …". `GET /api/account` returns `{ "configured": true, "signedIn": true, … }`.

Deploying somewhere else: add that origin's `/auth/callback`, origin and logout URL in the same three
fields, and set `APP_BASE_URL` to it.

## How it works

- **SDK:** `@auth0/nextjs-auth0` v4 (Regular Web App, authorization code flow with the client secret
  on the server). `lib/auth/auth0.ts` builds the client only when every key is present, and rebuilds
  it if they change. Scope is `openid profile email`: the email is only ever turned into a keyed
  hash (see [Email invites](#email-invites-private-tables)), there are no refresh tokens, and the
  SDK's `/auth/access-token` endpoint is turned off because OVR never calls an API as the student.
- **Routes:** `proxy.ts` (Next 16's middleware) mounts `/auth/login`, `/auth/logout`,
  `/auth/callback` and `/auth/profile`. `/auth/login?returnTo=/progress` comes back to that page.
  Auth0's page offers both sign-in and sign-up. Without keys the proxy passes everything through and
  `/auth/*` says sign-in isn't set up. API routes, Next's assets and files with an extension skip
  the proxy.
- **Session:** an encrypted, httpOnly cookie (`__session`, sealed with `AUTH0_SECRET`), rolling for a
  week of inactivity, at most 30 days. The ID token is verified at sign-in; afterwards the server
  only trusts what decrypts.
- **Who's asking:** `lib/auth/session.ts` reads the verified session (`sub` and a short name).
  `lib/learning/server/identity.ts` maps it to a learner:
  1. the learner already linked to that `sub`, else
  2. the browser's anonymous learner, if it isn't linked to anyone (so a student keeps the progress
     they made before signing in), else
  3. a new learner.

  A placeholder name ("Reader 1a2b") is replaced by the profile's first name only (`given_name`,
  else the first word of `name`; never an email address, a full name or the nickname, since the
  name can show on the opt-out leaderboard). `learnerFor` prefers the signed-in account, so every
  existing endpoint is per-account automatically.

- **Signing out** ends the Auth0 session. A learner that belongs to an account is only reachable
  with that account's session: its old anonymous cookie is treated as no cookie, so the next visitor
  on that browser starts fresh and can't see the account's library.
- **Not merged:** if you already have an account learner (say, from another computer) and sign in on
  a browser with separate anonymous progress, that browser's anonymous progress stays where it was.

### Email invites (private tables)

Whoever holds a private table can invite people by the email they signed up with, besides an invite
link and a Study Circle (`POST /api/tables/:tableId/email-invites { email }`, contract in
`apps/web/lib/tables/types.ts`). No email address is stored:

- **Hashing** (`lib/auth/emailHash.ts`): an address is trimmed and lowercased, ASCII only, then
  HMAC-SHA256'd (64 hex characters) with `EMAIL_HASH_SECRET` (at least 32 characters, or it's
  ignored), or a key derived from `AUTH0_SECRET` (HKDF) when that isn't set, read at request time.
  Keyed, so a copy of the database can't be checked against a list of known addresses. ASCII only
  because `toLowerCase` folds some other characters into ASCII (the Kelvin sign becomes `k`), which
  would let a verified look-alike address match someone else's invite. Changing the key in use
  forgets existing email invites.
- **Verification:** on every verified request, `lib/auth/session.ts` hashes the session's email
  only when the ID token says `email_verified: true` (exactly `true`), and
  `lib/learning/server/identity.ts` keeps `learners.email_hash` in step: that hash, or null when the
  email is unverified or missing. Sessions from before OVR asked for `email` have none until the
  student signs in again. One account per hash: the latest verified sign-in takes it.
- **Invites** keep the hash of what the holder typed and a masked form for the holder's own list
  (`bi•••@gmail.com`), for that one hold: giving the table up deletes them, and a new hold starts
  with none. Up to 20 per hold, and 30 adds per 10 minutes per student.
- **Access:** a private table lets in a signed-in student whose session's verified hash matches an
  email invite of the **live** hold (`access: "email"`), checked on every sit. `GET /api/tables`
  tells them in `invitedTo` (table, holder's first name, until when) and says in `emailVerified`
  whether there's a verified email at all; the holder alone gets `emailInvites` (masked).
- **No enumeration:** adding an invite never looks for an account. The answer is always
  `201 { invite: { id, masked } }`, after the same queries, whether or not anyone has that address.
- The email itself lives only where Auth0 put it: the encrypted session cookie. It never reaches the
  database, a log or another student.

### For feature code

```ts
import { requireUser } from "@/lib/auth/currentUser";

export async function GET(request: Request) {
  const me = await requireUser(request);
  if (me instanceof Response) return me; // 503 auth_not_configured, 401 sign_in_required, …
  const rows = await me.sql`SELECT … FROM collections WHERE owner_id = ${me.learnerId}`;
  // …
}
```

- `requireUser(request)`: the signed-in user `{ learnerId, signedIn: true, authSub, displayName,
sql }`, or a ready `Response`: `503 auth_not_configured` (no Auth0 keys), `503 not_configured` (no
  database), `401 sign_in_required`, `500 server_error`.
- `currentUser(request, { create? })`: signed in or not, `{ learnerId, signedIn, authSub,
displayName, setCookie? }`.
- `authFail(code, message, status)`: the same error body for your own `403 forbidden` or
  `404 not_found`. Answer `404` for another student's private item, so ids can't be probed.
- Browser: `useAccount()` (`lib/auth/useAccount.ts`) gives `{ status, account: { configured,
signedIn, displayName } }` from `GET /api/account`; `loginHref(path)` and `LOGOUT_HREF`
  (`lib/auth/links.ts`) are the links. Use plain `<a>` (not `next/link`) for them.
- Never take a learner id, owner id or role from the request. Check ownership or membership in the
  same query that reads or changes the row.

## Data model

Migrations `apps/web/db/migrations/0004_auth0_identity.sql`, `0005_circle_removals.sql` and
`0007_table_email_invites.sql` (`pnpm --filter @ovr/web db:migrate`):

| Table                      | What it holds                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learners`                 | New `auth0_sub` (unique, nullable): the Auth0 user id a learner belongs to. `email_hash` (unique, nullable): the keyed hash of a verified email, never the address. No other profile data is stored. |
| `collections`              | A personal library's collections: `owner_id` → learners, `name` (1–80).                                                                                                                              |
| `collection_items`         | Saved things: `kind` resource, lesson, plan or note; `title`; `url` (https only); `summary`; `payload` (JSON, up to 256 KB); `source_task_id`; `added_by`.                                           |
| `study_circles`            | Shared circles: `name` (1–80), `description`, `owner_id`.                                                                                                                                            |
| `circle_members`           | `(circle_id, learner_id)`, `role` owner, editor or viewer (one owner per circle), `joined_at`, `last_seen_at`.                                                                                       |
| `circle_invites`           | Invite links: only `token_hash` (SHA-256 of the token, `lib/auth/inviteToken.ts`), `role` editor or viewer, `expires_at`, `max_uses`, `uses`.                                                        |
| `circle_items`             | A circle's shared items, the same shape as `collection_items`.                                                                                                                                       |
| `circle_removals`          | `(circle_id, learner_id, removed_at)`: who the owner removed, and when. Invite links made before then don't let them back in.                                                                        |
| `table_hold_email_invites` | Email invites to one private table hold: `email_hash`, `masked` (for the holder's list), `created_by`; unique per hold and hash; deleted with the hold.                                              |

Deleting a learner deletes everything they own or added.

## Security checks

What the server enforces, whatever the browser sends (each has a regression test in
`lib/auth/security.test.ts`, `lib/circles/circles.test.ts`, `lib/librarian/server/context.test.ts`
or `lib/librarian/server/intake.test.ts`):

- **Identity** only from the verified session (or, signed out, the signed anonymous cookie).
  Linking adopts an _unlinked_ anonymous learner into an account that has no learner yet, and
  never merges into an existing one. After signing out, the old cookie reaches nothing of the
  account; the next person to sign in on that browser gets their own learner.
- **Ownership and roles** in the same query that reads or changes a row: another student's
  collection, item, source, plan, task or circle answers `404`; a role that's too low, `403`.
  Re-joining never changes a role. An owner's removal is final for every invite link made before
  it (a new link is the owner's choice).
- **CSRF:** both cookies are `SameSite=Lax`, and every cookie-authenticated `POST`, `PATCH` and
  `DELETE` (`/api/me`, `/api/circles`, `/api/librarian`, `/api/learning`) is refused with `403`
  when `Origin` or `Sec-Fetch-Site` says it came from another origin (`lib/auth/sameOrigin.ts`).
  Library and circle bodies must be `application/json` (`415` otherwise).
- **Sign-in links:** the proxy strips every `/auth/login` parameter except a same-site `returnTo`
  and `screen_hint`, so a crafted link can't widen the scope (OVR's own is set on the server),
  change the audience or force a prompt; `/auth/logout` takes no parameters (set **Allowed Logout URLs** to exactly
  `http://localhost:3100` as well).
- **The Librarian** sees only the asking student's own items and their circles' items, and only
  when the request points at them (names too). Her web searches go to TinyFish, so any search that
  carries a link or copies a private title or name the student didn't type is dropped on the
  server (`publicQueries`).
- **Email invites** count only for an email Auth0 says is verified, only for the hold they were made
  for, and only the holder sees or removes them. Inviting answers the same whether or not anyone
  has the address, and only keyed hashes are stored (`lib/tables/tables.test.ts`,
  `lib/auth/security.test.ts`).
- **Private responses** are `cache-control: private, no-store`. Logs carry error codes, not
  session contents or tokens. The client secret is read on the server at request time and never
  reaches a client bundle.

## Errors

Private endpoints answer `{ "error": { "code", "message" } }`:

| Status | Code                  | Meaning                                                                           |
| ------ | --------------------- | --------------------------------------------------------------------------------- |
| 503    | `auth_not_configured` | Sign-in isn't set up on this server (no Auth0 keys).                              |
| 401    | `sign_in_required`    | Sign in first (no session, or it didn't verify).                                  |
| 403    | `forbidden`           | Signed in, but your role doesn't allow that (or a change sent from another site). |
| 404    | `not_found`           | Nothing you can see by that id (also others' private items).                      |

## Tests

`pnpm --filter @ovr/web test` runs `lib/auth/auth.test.ts`: real SDK session cookies (a verified one
resolves the account's learner; a garbage one, or one sealed with another secret, is 401), first
sign-in linking, never linking a learner that belongs to someone else, the race between two first
requests, an account's learner unreachable through the anonymous cookie after signing out, safe
`returnTo` paths, invite-token hashing and email hashing (normalised, keyed, verified only, masked).
`lib/auth/security.test.ts` checks that a learner keeps only the hash of a verified email and drops
it when unverified; `lib/tables/tables.test.ts` covers email invites end to end (no enumeration,
the live hold only, removal, limits). Signing in against a real tenant needs the keys above.
