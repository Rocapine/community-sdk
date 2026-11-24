# Account Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member signed in to the host app's account gets one community profile on every device, with push on every device, linked through a server-verified account proof.

**Architecture:** An optional `accounts` module adds `account_links`, `merge_profiles` and two edge functions. `account-session` verifies a proof (Appwrite or JWKS), finds, converts or creates the account profile, merges the caller's own anonymous profile, and opens a real Supabase session server-side (`admin.generateLink` + `verifyOtp`). `account-delete` resets the profile and revokes every session. The push module gets an additive `push_devices` table. In core, `ensureIdentity` checks the stored session against the host's account, and the host drives `accountSignedIn` / `accountSignedOut` / `deleteAccountProfile`.

**Tech Stack:** Postgres (Supabase), Deno edge functions (`supabase-js` v2, `jose` for JWKS), TypeScript core (vitest), CLI (vitest).

**Spec:** `docs/superpowers/specs/2026-11-24-account-profiles-design.md`

## Global Constraints

- This repo is public. Nothing app-specific (app names, member numbers, ids) goes in code, docs, tests, commits or PRs.
- RLS policies and content tables are unchanged. No existing column or table changes shape; `push_tokens` stays as it is.
- Synthetic email: `account+<hex(hmac_sha256(COMMUNITY_ACCOUNT_SECRET, provider + ":" + subject))[0:32]>@account.invalid`.
- `account_links` is the only source of truth. An auth user is never adopted because of its email.
- Account-session secrets: `COMMUNITY_ACCOUNT_PROVIDER` (`appwrite` | `jwks`), `COMMUNITY_ACCOUNT_SECRET`.
  - For `appwrite`: `COMMUNITY_APPWRITE_ENDPOINT` and `COMMUNITY_APPWRITE_PROJECT`.
  - For `jwks`: `COMMUNITY_ACCOUNT_JWKS_URL`, `COMMUNITY_ACCOUNT_ISSUER`, `COMMUNITY_ACCOUNT_AUDIENCE` and `COMMUNITY_ACCOUNT_SUBJECT_CLAIM` (default `sub`).
- Every client-invoked function calls `preflight(req)` first.
- Optional app SQL hooks, each called only if it exists (`to_regprocedure`):
  - `public.account_profile_candidates(provider text, subject text, claims jsonb) returns setof uuid`;
  - `public.account_owns_profile(profile uuid, claims jsonb) returns boolean`;
  - `public.on_account_linked(profile uuid, provider text, subject text, claims jsonb) returns void`.
- Member without an account and `accounts.required` unset: behaviour identical to today.
- Release as a **patch**: the changeset covers core, ui and the CLI (linked).

## Review Focus

1. Host signed out while an account session is stored: the device must drop to a fresh anonymous profile, never keep posting as the account. (Task 6 test `account session without proof signs out`.)
2. Proof for account B while A's account session is stored: switch to B, never stay on A. (Task 6 test `different account switches`.)
3. Provider down (proof throws) or `account-session` 5xx: keep the current session, never sign in anonymously over an account session. (Task 6 test `provider failure keeps session`.)
4. A squatter user already holds the computed synthetic email: `account-session` must not hand its session out. It deletes the squatter and creates its own user. (Task 3 test `squatter is replaced`.)
5. The caller's anonymous profile is owned by someone else (already linked, or the `account_owns_profile` hook says no): neither converted nor merged. (Task 3 tests `foreign profile is left aside`.)

---

### Task 1: `accounts/001` — links and profile merge

**Files:**

- Create: `supabase/migrations/accounts/001_accounts.sql`
- Test: `supabase-tests/accounts.sql` (style of `supabase-tests/placeholders.sql`: one `do $$` block, raise `ACCOUNTS_TESTS_PASSED` at the end so everything rolls back)

**Interfaces:**

- Produces:
  - table `public.account_links(provider text, subject text, profile_id uuid references profiles(id) on delete cascade, linked_at timestamptz default now(), primary key (provider, subject), unique (profile_id))`, RLS on, no grants to `anon`/`authenticated`;
  - `public.merge_profiles(main uuid, other uuid) returns void`, security definer, service_role only;
  - `public.account_hook_exists(name text) returns boolean`, service_role only: `to_regprocedure` for the three hook signatures in Global Constraints.
  - `public.account_link_and_merge(p_provider text, p_subject text, p_main uuid, p_merge uuid[]) returns boolean` (true when the link is new), service_role only. In one transaction, it inserts the link if missing, then calls `merge_profiles(p_main, x)` for each `x` in `p_merge`.
  - `public.reset_profile_identity_for(p_profile uuid) returns void`, service_role only: the body of core's `reset_profile_identity` for a given profile.
  - `public.account_session_calls(subject_hash text primary key, at timestamptz not null)`, service_role only: the rate-limit store.

`merge_profiles` moves every row that references `other` through a foreign key to `profiles(id)`. For tables with a uniqueness on the user (likes, comment_likes, post_reactions, poll_votes, blocks, notification_reads, member_presence, push_tokens, push_devices): delete `other`'s duplicate, keep `main`'s. Optional-module tables are guarded with `to_regclass`.

Identity fields:

- `main` keeps `username`, `avatar_url` and `bio` when it set them itself (`username_set_by_user`). Otherwise it takes `other`'s values when `other` set them.
- `handle` stays `main`'s.
- `is_banned := main.is_banned or other.is_banned`.
- `is_admin`, `is_official` and `is_house` are never read from `other`.

- [ ] **Step 1: Write `supabase-tests/accounts.sql`** with these assertions:
  - two profiles `m` and `o`, with posts, comments, a like by `o` and a like by both on the same post: after `merge_profiles(m, o)`, `o` has 0 posts and 0 comments, and `m` has 1 like on that post (not 2);
  - `o` is banned, `m` is not → `m` is banned after the merge;
  - `o.is_admin = true` → `m.is_admin` is unchanged;
  - `m` has the default name and `o` has a chosen one → `m` takes `o`'s name. With both chosen, `m` keeps its own;
  - **FK coverage guard:** `select` every foreign key to `public.profiles(id)` from `information_schema`, insert a row through each where possible, merge, and assert no row still points at `o`;
  - `account_links` is not readable as `authenticated` (`set local role authenticated` → permission denied).
- [ ] **Step 2: Run on the sandbox**: `npx supabase db query --linked --yes -f supabase/migrations/accounts/001_accounts.sql && npx supabase db query --linked --yes -f supabase-tests/accounts.sql`. Expected: an error other than `ACCOUNTS_TESTS_PASSED` before the implementation, then exactly `ACCOUNTS_TESTS_PASSED`.
- [ ] **Step 3: Implement the migration** (idempotent: `create … if not exists`, `create or replace`).
- [ ] **Step 4: Re-run.** Expected: `ACCOUNTS_TESTS_PASSED`.
- [ ] **Step 5: Commit** `feat(accounts): account links and profile merge`.

### Task 2: `_shared/accounts.ts` — proof verifiers and synthetic email

**Files:**

- Create: `supabase/functions/_shared/accounts.ts`
- Test: `supabase/functions/_shared/accounts_test.ts`

**Interfaces:**

- Produces:
  - `type VerifiedAccount = { provider: string; subject: string; claims: Record<string, unknown> }`;
  - `syntheticEmail(secret: string, provider: string, subject: string): Promise<string>`;
  - `verifyProof(proof: string, env: AccountEnv, fetchImpl?: typeof fetch): Promise<VerifiedAccount>`, which throws `AccountProofError` (bad proof → 401) or `AccountProviderError` (provider unreachable or misconfigured → 503);
  - `readAccountEnv(get: (k: string) => string | undefined): AccountEnv`, which throws on a missing secret for the chosen provider.
- `appwrite` verifier:
  - `GET ${endpoint}/account` with headers `X-Appwrite-Project` and `X-Appwrite-JWT`;
  - a 401 from Appwrite is an `AccountProofError`;
  - `subject = $id`, `claims = { prefs, emailVerification, status }`;
  - `status === false` (a blocked user) is an `AccountProofError`.
- `jwks` verifier: `jose.jwtVerify` with `createRemoteJWKSet(url)`, issuer and audience; `subject = payload[subjectClaim]`, `claims = payload`.

- [ ] **Step 1: Write tests:**
  - `syntheticEmail` is deterministic, starts with `account+`, has 32 hex characters and ends with `@account.invalid`, and differs for another secret;
  - appwrite 200 → subject and prefs; appwrite 401 → `AccountProofError`; fetch throws → `AccountProviderError`; blocked user → `AccountProofError` (all with a stubbed `fetchImpl`);
  - jwks with a locally generated key pair served by a stubbed fetch: a valid token passes, a wrong audience → `AccountProofError`;
  - `readAccountEnv` without `COMMUNITY_ACCOUNT_SECRET` throws.
- [ ] **Step 2: Run** `cd supabase/functions && deno test --config deno.json --no-lock --allow-env _shared/accounts_test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Import `jose` through `deno.json` the way the other deps are imported.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): proof verifiers and peppered synthetic email`.

### Task 3: `account-session` edge function

**Files:**

- Create: `supabase/functions/account-session/index.ts` (thin: parse, call, respond)
- Create: `supabase/functions/_shared/account-session.ts` (logic, injectable dependencies)
- Test: `supabase/functions/_shared/account-session_test.ts`

**Interfaces:**

- Consumes: Task 1 (`account_links`, `merge_profiles`, `account_hook_exists`), Task 2 (`verifyProof`, `syntheticEmail`).
- Produces: `POST /account-session`, body `{ proof: string }`, optional `Authorization: Bearer <device access token>`. It answers:
  - `200 { access_token, refresh_token, profile_id, subject_hash }`, where `subject_hash` is the 32 hex characters of the synthetic email;
  - `401 { error: "bad_proof" }`;
  - `503 { error: "provider_unavailable" }`.
- `resolveAccountSession(deps, { verified, callerId })` in `_shared/account-session.ts`, with `deps` = `{ db, authAdmin, openSession, hooks }`. The flow:

  1. **Link exists** → `main = link.profile_id`.
  2. **Else, candidates** (hook, filtered to profiles with no link): `main` = the most recently active (latest post, comment, like or `created_at`), and the others are merged into it. `main`'s auth user gets the synthetic email.
  3. **Else, the caller is anonymous and owns its profile** (no link, and `account_owns_profile` is true or absent) → convert it: `authAdmin.updateUserById(callerId, { email, email_confirm: true })`.
  4. **Else** → `authAdmin.createUser({ email, email_confirm: true })`. If the email already exists on an unlinked user (a squatter), delete that user first.
  5. Insert the link. If `callerId ≠ main` and the caller owns its profile → `merge_profiles(main, callerId)`.
  6. Run `on_account_linked` when the link is new.
  7. `openSession(email)` = `generateLink({ type: "magiclink", email })` + `verifyOtp({ token_hash, type: "magiclink" })`.

- [ ] **Step 1: Write tests** with in-memory fakes for `db`, `authAdmin` and `openSession`:
  - `new account, owned anonymous caller is converted`: no link, caller `c` → `updateUserById(c, …)`, link `(provider, subject) → c`, no merge, `on_account_linked` called once;
  - `existing link`: a second device `d` → session for the linked profile, `merge_profiles(main, d)` called, `on_account_linked` not called;
  - `candidates adopt the most active profile`: candidates `p1` (active yesterday) and `p2` (active last week) → `main = p1`, `merge_profiles(p1, p2)` called;
  - `foreign profile is left aside` (a): the caller is linked to another account → no conversion, no merge, a new user is created;
  - `foreign profile is left aside` (b): `account_owns_profile` returns false → same as (a);
  - `squatter is replaced`: `createUser` fails with "already registered" and the email belongs to an unlinked user `s` → `deleteUser(s)`, then `createUser` succeeds; `s`'s session is never opened;
  - `bad proof` → 401 and no db call; `provider down` → 503.
- [ ] **Step 2: Run** `deno test … _shared/account-session_test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. Rate limit: refuse with `429` when `account_session_calls.at` for this `subject_hash` is under 10 s old, otherwise upsert it. Run step 5 (link + merges) through `account_link_and_merge`, so a crash never leaves a link without its merge.
- [ ] **Step 4: Run** the unit tests, then `deno check --config deno.json --no-lock account-session/index.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): account-session opens the account profile's session`.

### Task 4: `account-delete` edge function

**Files:**

- Create: `supabase/functions/account-delete/index.ts`, logic in `supabase/functions/_shared/account-session.ts` (`deleteAccountProfile(deps, verified)`)
- Test: extend `_shared/account-session_test.ts`

**Interfaces:**

- Produces: `POST /account-delete` with `{ proof }`, or with the service role and `{ provider, subject }`. It answers `200 { deleted: boolean }` (false when there was no link).
- Effects, in order:

  1. `reset_profile_identity_for(profile)` (Task 1).
  2. Delete its `push_tokens` and `push_devices` rows.
  3. Revoke every session: delete the user's rows from `auth.sessions` (cascades to `auth.refresh_tokens`) in SQL, inside the same RPC call as step 1.
  4. Delete the link, then `updateUserById(profile, { email: <random uuid>@deleted.invalid })`.

- [ ] **Step 1: Write tests:**
  - `delete resets, revokes, unlinks`: the fakes record the four effects in order;
  - a service-role call with `{ provider, subject }` works without a proof;
  - an unknown account → `{ deleted: false }` with no effect.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): account-delete`.

### Task 5: push on several devices (`push/006`)

**Files:**

- Create: `supabase/migrations/push/006_push_devices.sql`
- Modify: `supabase/functions/_shared/push.ts`; `notify-like`, `notify-comment`, `notify-reaction` and `broadcast-post` `index.ts` (the `push_tokens` lookups)
- Test: `supabase/functions/_shared/push_test.ts`, `supabase-tests/push-devices.sql`

**Interfaces:**

- Produces:

  - table `public.push_devices(user_id uuid references profiles(id) on delete cascade, device_id text, expo_push_token text not null, updated_at timestamptz default now(), primary key (user_id, device_id))`. RLS lets a member insert, update, select and delete only its own rows;
  - `recipientTokens(db, userId: string): Promise<{ tokens: string[]; prefs: { notify_likes: boolean; notify_comments: boolean } }>`, the de-duplicated union of `push_devices.expo_push_token` and `push_tokens.expo_push_token`, with prefs from `push_tokens` (default true when there's no row);
  - `sendExpoPushBatch` returns `{ invalidTokens: string[] }`, the tokens whose ticket has `details.error === "DeviceNotRegistered"`. Callers delete those from `push_devices`, and null them in `push_tokens`.

- [ ] **Step 1: Write tests:**
  - `recipientTokens unions and dedupes` (a legacy token equal to a device token is counted once);
  - `prefs default to true without a push_tokens row`;
  - `DeviceNotRegistered tokens are returned` (stubbed fetch answering one ok ticket and one error ticket);
  - SQL: a member can't read another member's `push_devices` row.
- [ ] **Step 2: Run** (deno test + `supabase-tests/push-devices.sql` on the sandbox). Expected: FAIL.
- [ ] **Step 3: Implement**, and switch the four functions to `recipientTokens`, sending one message per token.
- [ ] **Step 4: Run.** Expected: PASS, and `deno check` of the four functions is clean.
- [ ] **Step 5: Commit** `feat(push): one profile, several devices`.

### Task 6: core — account identity and transitions

**Files:**

- Modify: `packages/core/src/config.ts`
  - `CommunityHostAdapters`: add `getAccountProof?: () => Promise<{ provider: string; token: string } | null>` and `getInstallId?: () => string | null`;
  - option `accounts?: { required?: boolean }` on the config.
- Modify: `packages/core/src/identity.ts`
- Create: `packages/core/src/push-devices.ts` with `registerPushDevice(cfg, token: string): Promise<void>` and `unregisterPushDevice(cfg): Promise<void>`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/__tests__/identity.test.ts` (new or extended), `packages/core/src/__tests__/pushDevices.test.ts`

**Interfaces:**

- Consumes: Task 3 (`account-session` response), Task 4, Task 5 (`push_devices`).
- Produces: `accountSignedIn(cfg): Promise<void>`, `accountSignedOut(cfg): Promise<void>` and `deleteAccountProfile(cfg): Promise<boolean>`, all exported. `ensureIdentity` keeps its signature.
- A session is an **account session** when its `user.email` ends with `@account.invalid`. Its hash is the local part after `account+`.
- `ensureIdentity` (bootstrap), when the host provides `getAccountProof`:

  1. stored session, anonymous → keep it;
  2. stored account session and `getAccountProof()` resolves `null` → `accountSignedOut`, then continue as no session;
  3. stored account session and a proof → call `account-session` with the proof. If the returned `subject_hash` differs from the stored one → `setSession` (switch). Same hash → keep. To avoid a call on every launch, cache `{ subject_hash, checkedAt }` in memory and re-check once per launch;
  4. no session and a proof → `account-session`, then `setSession`;
  5. no session, no proof → anonymous, unless `accounts.required` (then it returns `null` and stays hidden);
  6. the proof throws, or `account-session` gives a 5xx or network error → keep whatever session there is and return its id. No stored session → `null` (retry on the next call), never `signInAnonymously()` when `accounts.required`.

- [ ] **Step 1: Write tests** (vitest, mocked supabase client with `auth.getSession`, `setSession`, `signOut`, `signInAnonymously` and `functions.invoke`):
  - `account session without proof signs out`: stored account session and proof `null` → `push_devices` delete, `signOut({ scope: "local" })`, then `signInAnonymously` called once;
  - `different account switches`: stored hash `aaa…` and a response hash `bbb…` → `setSession` with the new tokens;
  - `same account keeps session`: same hash → no `setSession`;
  - `provider failure keeps session`: `getAccountProof` throws → no `signOut`, no `signInAnonymously`, returns the stored id;
  - `required without proof returns null` and never calls `signInAnonymously`;
  - `accountSignedIn converts the anonymous session`: invokes `account-session` with the device token and calls `setSession`;
  - `deleteAccountProfile` invokes `account-delete`, then signs out locally, and returns `true`;
  - `registerPushDevice` upserts `(user_id, device_id = host.getInstallId())`, and is a no-op without an install id.
- [ ] **Step 2: Run** `npm test -w @rocapine/community-core`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test -w @rocapine/community-core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): account sessions and transitions`.

### Task 7: CLI module, docs, changeset, sandbox end-to-end

**Files:**

- Modify: `packages/cli/src/install-shared.ts`
  - `MODULE_ORDER`: add `"accounts"` after `"presence"`;
  - `const ACCOUNTS_FUNCTIONS = ["account-session", "account-delete"]`, wired in `functionsForModules`.
- Modify: `packages/cli/src/__tests__/init.test.ts` and `upgrade.test.ts` (migration/function counts, plus an `accounts` module test); `packages/cli/src/index.ts` help strings.
- Modify: `README.md` (modules table), `docs/integration.md` (host hooks, transitions, secrets, "turn email sign-ups off" advice), `docs/backend-runbook.md` (deploy and secrets), `packages/core/README.md`.
- Create: `.changeset/account-profiles.md` (patch, linked packages).

- [ ] **Step 1: Write the CLI test** `init with --modules accounts installs account-session and account-delete and accounts/001`. Run `npm test -w @rocapine/community`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 2: Sandbox end-to-end** (the sandbox the maintainers use; never prod):

  1. push the migrations and deploy the two functions with test secrets (`COMMUNITY_ACCOUNT_PROVIDER=jwks` against a local test issuer, or the app's real provider);
  2. run a throwaway script like the spike (`generateLink`/`verifyOtp`): device 1 anonymous → `account-session` → converted; device 2 anonymous with a post → `account-session` → same `profile_id`, and the post now belongs to it; `account-delete` → device 1 refresh fails;
  3. delete the test users.

  Expected: every check passes. Record the commands in `docs/backend-runbook.md`.

- [ ] **Step 3: Run the repo gates:** `npm run typecheck && npm test`, `npx prettier --check .` (the repo's own prettier binary), and the CI deno commands from `.github/workflows/ci.yml`. Expected: all green.
- [ ] **Step 4: Commit** `feat(accounts): CLI module, docs and changeset`, then open the PR (generic description, no app names).
