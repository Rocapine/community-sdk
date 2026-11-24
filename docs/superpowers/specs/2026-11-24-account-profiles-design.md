# Account profiles: one community profile per app account, on every device

Status: draft for approval (24 Nov 2026).

## Why

Today every install signs in to Supabase anonymously (`ensureIdentity` →
`signInAnonymously()`), so each install owns its own profile. Three problems
follow for a member who has an account in the host app:

- **No sync between devices.** A post written on the phone does not show on the
  member's profile on the tablet or the web app. Reinstalling, or changing phones,
  starts a new profile and loses the old one's history.
- **Duplicate profiles.** One person ends up with one profile per install, and an
  app sees members with several profiles each.
- **Unverified identity.** The host's ids on a profile (`revenuecat_id`,
  `amplitude_id`) are written by the client. Nothing proves them, so they can't
  safely open the right profile, nor safely attach imported history to a member.

## Goals

- A member signed in to the host app's account gets the **same profile on every
  device**: posts, comments, likes, reactions, votes, name, photo, bio, inbox and
  read state, blocks.
- **Push notifications reach every device** of the profile.
- The link between an account and a profile rests on a **proof verified
  server-side**, never on a client-written id.
- **Generic.** Any app plugs in its own account system (Appwrite, Supabase Auth,
  Firebase, Clerk, a custom backend…), and chooses whether the community
  requires an account.

## Non-goals

- **Members without an account keep today's behaviour**: one anonymous profile
  per install, lost if they reinstall or change phones. Nudging them to create an
  account is a later, separate piece of work (UI copy, prompts).
- No change to RLS policies, nor to how content tables reference profiles.
- No account system inside the SDK: the host app owns sign-up, sign-in and
  account deletion.

## Anti-goals

- A member must never land on someone else's profile: not after a logout, not
  after an account switch on a shared device, not because of a stale push token.
- A failure of the account provider (down, offline) must never silently replace
  a member's account profile with a fresh anonymous one.

## Approaches considered

|                | Approach                                                                                | Trade-off                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A              | The server signs its own Supabase access token for the account's profile                | Simple, but there's no refresh token: the app would need a fresh account proof every hour, offline included. It also means handling the project's signing key. |
| **B (picked)** | **The server opens a real Supabase session** for the profile's auth user and returns it | Refresh, persistence, offline and remote revocation all work as today, and RLS is untouched. Costs a synthetic email on account-linked auth users.             |
| C              | Several auth users (one per device) map to one profile                                  | No session minting, but every RLS policy moves from `auth.uid()` to a profile lookup: a rewrite of the whole SDK backend, for every app.                       |

B was picked (24 Nov 2026).

## Design

### Vocabulary

- **Account**: the member's identity in the host app's own account system
  (Appwrite user, Supabase Auth user of another project, Firebase user…).
- **Account proof**: a short-lived token the host app obtains from that system,
  e.g. an Appwrite JWT (`account.createJWT()`, 15 min) or a Firebase ID token.
- **Account profile**: the community profile linked to an account. It is a
  normal `profiles` row whose `auth.users` row carries a synthetic email
  `account+<sha256(provider:subject)[0:24]>@account.invalid`.

### Backend (SDK module `accounts`, optional)

New migration `accounts/001_accounts.sql`:

- `account_links(provider text, subject text, profile_id uuid, linked_at timestamptz)`.
  `(provider, subject)` and `profile_id` are both unique, and the table is
  readable only by the service role.
- `merge_profiles(main uuid, other uuid)`: moves posts, comments, likes, reactions, poll
  votes, blocks, notifications and read state onto `main`, keeping `main`'s row
  whenever both exist. `other` keeps its row, emptied. Identity fields
  (_my call_): `main` keeps its own name, photo and bio when the member set
  them; otherwise it takes the most recently set ones from `other`. `handle` stays `main`'s. A ban follows the person: `main`
  becomes banned if `other` was. Staff flags (`is_admin`, `is_official`,
  `is_house`) are never copied from `other`.
- Hook: when a link is created, the function calls
  `public.on_account_linked(profile_id, provider, subject)` if it exists. Apps
  define it to add their own logic (e.g. attaching imported history).

New edge function `account-session`. It is called by the SDK with
`{ proof, provider }` and the device's current access token, if any:

1. **Verify the proof** with the configured verifier, which yields `subject` and
   optional `claims`:
   - `appwrite`: `GET <endpoint>/account` with `X-Appwrite-JWT: <proof>` and
     `X-Appwrite-Project`; `subject` = the user's `$id`, and the claims carry
     `prefs`.
   - `jwks`: standard JWT verification (`COMMUNITY_ACCOUNT_JWKS_URL`, issuer,
     audience, subject claim). This covers Supabase Auth, Firebase, Clerk, Auth0
     and any OIDC provider.

   Secrets: `COMMUNITY_ACCOUNT_PROVIDER` plus that verifier's settings.

2. **Find or create the account profile:**
   - **link exists** → that profile;
   - **no link, and the app's `account_profile_candidates(provider, subject, claims)`
     hook (optional SQL function) returns existing profiles** → the most recently
     active one becomes the account profile and the others are merged into it
     (_my call_). An app uses this to adopt the member's existing main profile
     (history, chosen name and handle) instead of the calling device's;
   - **no link, and the caller has an anonymous profile** → convert it in place.
     The admin API sets the synthetic email on that auth user (it is no longer
     anonymous), and the link is created. The member keeps everything they wrote
     on this device.
   - **no link, no caller** → create a new auth user with the synthetic email,
     then create the link.
3. **If the caller's anonymous profile is not the account profile** (a second
   device, a reinstall), `merge_profiles(account, caller)` brings this device's
   content into the account profile, **only when that profile belongs to nobody
   else** (decided 24 Nov): no other account link, and the app's optional
   `account_owns_profile(profile, claims)` hook agrees (e.g. the profile's
   host id is empty or equals the one in the verified claims). Otherwise it is left
   aside, untouched. The same rule applies to the in-place conversion of step 2.
   Once phase 2 ships, every logout resets the device's community identity, so
   this case dies out.
4. **Open a session.** `auth.admin.generateLink({ type: 'magiclink', email })`,
   then `auth.verifyOtp({ token_hash, type: 'magiclink' })` server-side. The
   function returns `{ access_token, refresh_token, profile_id }`.
5. Run `on_account_linked` when a link was created.

New edge function `account-delete`, called with a valid account proof (or by the
host's backend with the service role and `{ provider, subject }`):

- `reset_profile_identity` on the account profile: default name, no bio, no
  avatar. Posts stay under the default pseudonym, as today.
- Deletes every push token of the profile and signs out every session of that
  auth user, so all devices drop it.
- Deletes the link, then clears the synthetic email. The profile becomes an
  ordinary orphan and can never be linked again.

### Push on several devices (push module, additive, `push/006`)

Builds already in the field must keep working, so nothing existing changes shape
(_my call_):

- `push_tokens` stays as it is: one row per profile, holding the preferences
  (`notify_likes`, `notify_comments`, which therefore apply to every device) and
  the token old builds write.
- New table `push_devices(user_id, device_id, expo_push_token, updated_at)`,
  key `(user_id, device_id)`. `device_id` comes from a new host hook
  `host.getInstallId()` (a stable per-install id the host already has).
- The SDK takes over registration: `registerPushDevice(token)` upserts this
  device's row (new builds stop writing `push_tokens.expo_push_token`).
- `notify-*` and `broadcast-post` send to the union of `push_devices` tokens and
  the legacy `push_tokens` token, without duplicates. A token Expo reports as
  `DeviceNotRegistered` is deleted.
- On logout, the SDK deletes this device's `push_devices` row before dropping
  the session.

### Client (core)

- New host hook: `host.getAccountProof?(): Promise<{ provider: string; token: string } | null>`.
  `null` means "not signed in"; a throw means "signed in, but no proof right now".
- New option `accounts?: { required?: boolean }`. With `required`, the SDK never
  signs in anonymously: without a proof there is no session, so the community is
  hidden (every read policy is `to authenticated`) and the host shows its own
  sign-in instead (_my call_).
- `ensureIdentity` (bootstrap), with the stored session checked against the
  host's account (_my call_, so a member never lands on someone else's profile
  when the host's session expired without a logout):
  - a stored **account** session (synthetic email) and `getAccountProof()`
    returns `null` → the host is signed out: run `accountSignedOut()`;
  - a stored account session and a proof for a **different** account (the SDK
    compares `sha256(provider:subject)` with the email's hash; the function
    returns `subject` with every session) → `accountSignedOut()` then
    `accountSignedIn()`;
  - a stored anonymous session, or an account session matching the proof →
    keep it (as today);
  - no session, and `getAccountProof` returns a proof → `account-session`, then
    `setSession`;
  - no session, no proof, and not `required` → anonymous, as today;
  - the proof throws or `account-session` fails → keep the anonymous session if
    there is one, and retry on the next call. Never sign in anonymously over an
    account session.
- Transitions, called by the host:
  - `accountSignedIn()`: if the current session is anonymous, call
    `account-session` with it (conversion or merge, see the backend steps), then
    `setSession` and reset the memos.
  - `accountSignedOut()`: delete this device's push row, `signOut({ scope: 'local' })`,
    reset memos. The next `ensureIdentity` creates a fresh anonymous profile.
    A switch A → B is `accountSignedOut()` then `accountSignedIn()`.
  - `deleteAccountProfile()`: calls `account-delete`, then does what
    `accountSignedOut()` does. The host must call it **before** disabling the
    account, while a proof can still be issued.
- The profile's `revenuecat_id` / `amplitude_id` sync stays as it is
  (analytics labels only).

### Host integration

Each app's own design covers its proof hook, its transitions (sign-in, sign-out,
account deletion), its install id, its verifier secrets and its optional SQL hooks.

## Before planning: feasibility spike (sandbox)

Approach B rests on Supabase behaviours to confirm on the sandbox project first:

- server-side `generateLink` + `verifyOtp` returns a usable session while
  anonymous sign-ins stay on, email sign-ups stay off, and no email is sent;
- converting an anonymous auth user by setting an email through the admin API
  keeps its id, and its profile, intact;
- nobody can create a user on `@account.invalid` from the public API (email
  sign-ups off), so a link can't be squatted;
- per-IP rate limits on `verifyOtp` don't bite when every call comes from the
  edge function.

If one fails, we come back to A or C before writing the plan.

## Left to the builder

- Exact names of the functions, migrations and SQL helpers, and test layout.
- Whether `merge_profiles` is SQL-only or partly in the function (the
  notifications and read-state tables differ between modules).
- Rate limiting of `account-session` (one per device per minute is enough).
- How the SDK test suite fakes the verifiers.
