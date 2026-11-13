# Community dashboard, brick 13: communities and access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rocapinians add a community (app × env) from the dashboard, and each person sees only the apps they were given, with a role per app enforced by the Worker.

**Architecture:** The community registry moves from the `COMMUNITIES` var and Worker secrets to a D1 database (`DB`): apps, communities (secret key AES-GCM-encrypted under a master key held as a Worker secret), access and audit. `route()` stays the single entry point: after `verifyAccess` it loads the community and the caller's role in one D1 query, checks the route against the role, decrypts the key and hands the handlers the same `Community` they use today. New registry routes live outside `/api/c/…`; the SPA gets an Add sheet and a Settings sheet off the community switcher, plus Viewer gating.

**Tech Stack:** Cloudflare Worker + D1 + Web Crypto, React 19, TanStack Query, shadcn/ui, vitest (node + happy-dom), `node:sqlite` as the D1 stand-in in tests.

**Spec:** [docs/superpowers/specs/2026-11-12-community-dashboard-access-design.md](../specs/2026-11-12-community-dashboard-access-design.md)

**Repo:** all code is in `Rocapine/community-dashboard` (`/Users/glsx/Developer/community-dashboard`), on a branch `feat/brick13-communities-access`. Only Task 12's roadmap line touches this SDK repo.

## Global Constraints

- No SDK change.
- A Supabase secret key is never returned by the API (not even masked), never logged, never in an audit row, never stored in plain text. It is decrypted only in the Worker, for the request that needs it.
- A preview (`PREVIEW` var set) never reaches a `prod` community: not listed, not served (404 `unknown_community`), not added (400 `prod_in_preview`), not imported.
- Roles: `viewer` < `editor` < `owner`. GET routes need Viewer, writes need Editor, settings/key/remove/access routes need Owner. Dashboard admins (`DASHBOARD_ADMINS`) are Owner of every app; only they delete an app.
- Emails are compared lowercased and trimmed everywhere (Access JWT, `DASHBOARD_ADMINS`, access rows). Only `@rocapine.com` emails can be granted.
- Supabase URL accepted only as `https://<20 lowercase alphanumerics>.supabase.co` (after trim, lowercase, trailing `/` removed).
- An app always keeps at least one Owner row once it has one: the last can't be removed or downgraded (409 `last_owner`). Admins are not counted as owners.
- Audit rows are never deleted and keep the app id as text (no foreign key).
- Writes stay JSON-only and same-origin (the existing CSRF guard in `route()`).
- UI copy in English, no hint text under fields, calm UI, production keeps its orange mark. Sheets, not pages. Dashboard roles never use the word "admin" for an app role (that word is the community's own `is_admin`).
- Exact copy (use verbatim):
  - check `url`: "This isn't a Supabase project URL (https://<ref>.supabase.co)."
  - check `unreachable`: "Could not reach this project."
  - check `key`: "This key can't read the database."
  - check `schema`: "No community schema here: run the SDK's migrations first."
  - `project_taken`: "This project is already in the dashboard." · `app_taken`: "This id is taken."
  - production confirm: "This is a production community: real members will see what is published from here."
  - `last_owner`: "An app needs at least one owner." · Viewer tooltip: "Viewers can't change anything"

## Review Focus

1. **Email case.** Access may hand `Stan@Rocapine.com`; `DASHBOARD_ADMINS` may hold `" stan@rocapine.com "`. Both must match the lowercase row. Test in Task 3.
2. **Pasted key with whitespace or a newline.** Trimmed before the check and before encryption, or the stored key fails later. Test in Task 5.
3. **URL pasted from the Supabase dashboard** with a trailing `/` or capitals: normalized, not refused. Test in Task 5.
4. **Two people adding the same project at once.** The UNIQUE constraint answers 409 `project_taken`, not a 500. Test in Task 6.
5. **An app id that collides with a route** (`api`, `assets`) or an existing app: refused with `bad_app_id` / `app_taken`. Test in Task 6.

## Before Task 1: Cloudflare resources (Guillaume)

Not needed for Tasks 1–11 (tests use a local D1 stand-in, `wrangler dev` a local D1), needed before merge. Guillaume runs these, or allows them:

```bash
npx wrangler d1 create community-dashboard
npx wrangler d1 create community-dashboard-preview
openssl rand -base64 32 | npx wrangler secret put MASTER_KEY_V1
```

The preview master key is a different value, set as a Previews secret named `MASTER_KEY_V1` (Workers Builds → Previews, as the sandbox key is today). The two database ids go into `wrangler.jsonc` in Task 11.

## File map

| File                                                         | Responsibility                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `migrations/0001_registry.sql` (create)                      | D1 schema: `apps`, `communities`, `access`, `audit`                       |
| `test/d1.ts` (create)                                        | `makeD1()`: a `D1Database` over `node:sqlite` with the migrations applied |
| `test/registryFixture.ts` (create)                           | `testEnv()`, `seedCommunity()` for every Worker test                      |
| `src/worker/keys.ts` (create)                                | `encryptKey` / `decryptKey` (AES-GCM, versioned master key)               |
| `src/worker/roles.ts` (create)                               | admins, role lookup, required role per route                              |
| `src/worker/registry.ts` (create)                            | D1 reads/writes of the registry, `toPublic`, audit                        |
| `src/worker/settings.ts` (create)                            | validation of community settings (topics, links, attachment types)        |
| `src/worker/check.ts` (create)                               | URL rule + key/schema/module check before saving                          |
| `src/worker/registryRoutes.ts` (create)                      | `/api/check`, `/api/communities` POST, `/api/apps/…`, `/api/admin/import` |
| `src/worker/router.ts`, `env.ts`, `supabase.ts` (modify)     | D1 lookup, role gate, decrypted key                                       |
| `src/worker/communities.ts` (shrink, then delete in Task 12) | legacy `COMMUNITIES` parsing, import only                                 |
| `src/shared/types.ts`, `src/shared/slug.ts` (modify/create)  | `Role`, `Me`, `CommunitySettings`, `AppDetail`, `slugify`, `APP_ID`       |
| `src/app/community.ts`, `src/app/registry/*` (modify/create) | hooks, `useCanEdit`, Add sheet, Settings sheet, No-access screen          |

---

### Task 1: Registry schema and the test D1

**Files:**

- Create: `migrations/0001_registry.sql`, `test/d1.ts`
- Modify: `src/worker/env.ts`
- Test: `test/d1.test.ts`

**Interfaces:**

- Produces: `makeD1(): D1Database` (test only) supporting `prepare().bind().first/all/run`, `batch` (one transaction), `exec`; foreign keys on. Tables below, used by every later task.
- Produces: `Env` gains `DB: D1Database; DASHBOARD_ADMINS: string; MASTER_KEY_VERSION: string; PREVIEW?: string`; `COMMUNITIES` becomes optional (`COMMUNITIES?: string`).

Schema (exact):

```sql
CREATE TABLE apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE communities (
  app TEXT NOT NULL REFERENCES apps(id), env TEXT NOT NULL CHECK (env IN ('prod','sandbox')),
  supabase_url TEXT NOT NULL UNIQUE, key_ciphertext TEXT NOT NULL, key_iv TEXT NOT NULL, key_version INTEGER NOT NULL,
  settings TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (app, env));
CREATE TABLE access (
  app TEXT NOT NULL REFERENCES apps(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('viewer','editor','owner')),
  granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY (app, email));
CREATE INDEX access_email ON access(email);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, app TEXT NOT NULL,
  env TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
CREATE INDEX audit_app ON audit(app, id DESC);
```

`settings` is JSON `{ amplitudeUserUrl: string|null, revenuecatCustomerUrl: string|null, topics: TopicOption[], attachmentTypes: string[] }`.

- [ ] **Step 1: Write the failing tests** in `test/d1.test.ts`: `it("applies the registry migration")` (the four tables exist), `it("refuses a second community on the same Supabase URL")` (second insert throws `/UNIQUE/`), `it("refuses env 'production' and role 'admin'")` (throws `/CHECK/`), `it("refuses a community of an unknown app")` (throws `/FOREIGN KEY/`), `it("batch is all or nothing")` (a batch whose 2nd statement fails leaves the 1st unapplied).
- [ ] **Step 2:** `npx vitest run test/d1.test.ts` → FAIL (`makeD1` missing).
- [ ] **Step 3:** Write the migration and `test/d1.ts` (`DatabaseSync` from `node:sqlite`, `PRAGMA foreign_keys = ON`, runs every `migrations/*.sql` in name order; `run()` returns `{ meta: { changes } }`, `all()` returns `{ results }`, `batch` wraps `BEGIN`/`COMMIT`/`ROLLBACK`). Update `Env`.
- [ ] **Step 4:** `npx vitest run test/d1.test.ts` → PASS; `npx tsc -p tsconfig.worker.json --noEmit` → no errors.
- [ ] **Step 5: Commit** `feat(registry): D1 schema for apps, communities, access and audit`.

### Task 2: Key encryption

**Files:** Create `src/worker/keys.ts`; Test `test/keys.test.ts`.

**Interfaces:**

- Produces: `interface KeyBox { ciphertext: string; iv: string; version: number }` (base64 strings).
- Produces: `encryptKey(env: Env, aad: string, plain: string): Promise<KeyBox>` — uses `MASTER_KEY_V${env.MASTER_KEY_VERSION}`; `decryptKey(env: Env, aad: string, box: KeyBox): Promise<string>` — uses `MASTER_KEY_V${box.version}`. `aad` is `` `${app}/${env}` `` so a ciphertext can't be moved to another row. Master keys are base64 of 32 random bytes; a missing or wrong-length master key throws `Error("master key v<n> unavailable")` (no key material in the message).

- [ ] **Step 1: Failing tests:** `it("round-trips a key")`; `it("uses a fresh iv each time")` (two encryptions of the same key differ); `it("fails with another row's aad")` (`decryptKey(env, "unchaind/sandbox", boxFromProd)` rejects); `it("decrypts with the version stored on the row")` (encrypt under v1, set `MASTER_KEY_VERSION: "2"` with both keys present, decrypt still works, new encryptions carry `version: 2`); `it("throws without the master key, naming no secret")`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement with `crypto.subtle` AES-GCM, 12-byte iv, `additionalData` = UTF-8 of `aad`. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(registry): encrypt Supabase keys under a versioned master key`.

### Task 3: Roles

**Files:** Create `src/worker/roles.ts`; modify `src/shared/types.ts` (add `Role`); Test `test/roles.test.ts`.

**Interfaces:**

- Produces: `type Role = "viewer" | "editor" | "owner"` in `src/shared/types.ts`.
- Produces: `normEmail(e: string): string` (trim + lowercase); `isAdmin(env: Env, email: string): boolean` (`DASHBOARD_ADMINS` is comma-separated); `atLeast(have: Role, need: Role): boolean`; `requiredRole(method: string, routeKey: string): Role` where `routeKey` is the router's `"METHOD first-segment"` and `OWNER_ROUTES = new Set(["GET settings", "PUT settings", "POST key", "DELETE community"])`; `roleFor(env: Env, email: string, app: string): Promise<Role | null>` (admin → `"owner"`, else the `access` row, else `null`).

- [ ] **Step 1: Failing tests:** `isAdmin` true for `"Stan@Rocapine.com"` when `DASHBOARD_ADMINS: " stan@rocapine.com ,guillaume@rocapine.com"` (Review Focus 1); `requiredRole("GET","queue") === "viewer"`, `("POST","items") === "editor"`, `("PUT","settings") === "owner"`, `("DELETE","community") === "owner"`; `atLeast("editor","viewer")` true, `atLeast("viewer","editor")` false; `roleFor` returns the row's role for a mixed-case email, `null` without a row, `"owner"` for an admin without a row.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(registry): per-app roles and dashboard admins`.

### Task 4: The router reads D1

**Files:**

- Create: `src/worker/registry.ts` (reads only in this task), `test/registryFixture.ts`
- Modify: `src/worker/router.ts`, `src/worker/supabase.ts`, `src/worker/communities.ts`, `src/shared/types.ts`
- Test: `test/router.test.ts`, `test/team.test.ts`, `test/drafts.test.ts`, `test/communities.test.ts` (updated), `test/registry.test.ts` (new)

**Interfaces:**

- Consumes: `decryptKey`, `KeyBox` (Task 2); `roleFor`, `requiredRole`, `atLeast`, `isAdmin`, `normEmail` (Task 3).
- Produces: `Community` (moved to `registry.ts`): `{ app; env: "prod"|"sandbox"; name; supabaseUrl; amplitudeUserUrl?; revenuecatCustomerUrl?; topics: TopicOption[]; attachmentTypes: string[]; secretKey: string }` — the field names the handlers use today, minus `keySecret`, plus the decrypted `secretKey` (in memory only).
- Produces: `loadCommunity(env: Env, email: string, app: string, envName: string): Promise<{ community: Community; role: Role } | null>` — one query joining `communities`, `apps` and the caller's access row; `null` when the row is missing, the caller has no role, or `envName === "prod" && env.PREVIEW`.
- Produces: `listVisible(env: Env, email: string): Promise<PublicCommunity[]>` (admins see all; preview drops prod; ordered by app name then prod first).
- Produces: `toPublic(c, role): PublicCommunity`; `PublicCommunity` gains `role: Role`. `Me = { email: string; isAdmin: boolean; admins: string[] }` in `types.ts`.
- Produces: `Ctx` gains `role: Role`. `clientFor(env, c)` keeps its signature and uses `c.secretKey`.
- Produces (test): `testEnv(db: D1Database, over?: Partial<Env>): Env` (fixed `MASTER_KEY_V1`, `MASTER_KEY_VERSION: "1"`, `DASHBOARD_ADMINS: "dev@rocapine.com"`, `DEV_ACCESS_EMAIL: "dev@rocapine.com"`); `seedCommunity(env, { app, env, name?, supabaseUrl?, secretKey?, settings?, access?: [email: string, role: Role][] }): Promise<void>`.

Behaviour in `route()`: `/api/communities` → `listVisible`; `/api/me` → `{ email, isAdmin, admins }`; `/api/c/:app/:env/…` → `loadCommunity` (null → 404 `unknown_community`), handler lookup (none → 404 `not_found`), then `atLeast(role, requiredRole(method, rest[0]))` else 403 `forbidden`. `communities.ts` keeps only `parseCommunities` and its type, renamed `LegacyCommunity`, for Task 7.

- [ ] **Step 1: Update the existing tests** to build their env with `testEnv(makeD1())` + `seedCommunity` instead of `COMMUNITIES`; the "lists communities" expectation gains `role: "owner"`; the "internal error" test breaks D1 instead (e.g. a `DB` whose `prepare` throws). Remove the `findCommunity`/`toPublic` cases from `communities.test.ts`.
- [ ] **Step 2: New failing tests** in `test/router.test.ts`: `it("lists only the apps the caller can see")` (viewer of app A, nothing on app B → only A, with `role: "viewer"`); `it("a community the caller can't see is unknown")` → 404 `unknown_community`; `it("a viewer can read but not write")` (GET summary 200, POST items 403 `forbidden`, and an Editor gets 403 on a route key in `OWNER_ROUTES` once Task 6 adds them); `it("a preview never serves prod")` (`PREVIEW: "1"`, prod seeded → list without it, `/api/c/unchaind/prod/summary` 404); `it("me says whether the caller is a dashboard admin")`. In `test/registry.test.ts`: `loadCommunity` decrypts the seeded key into `secretKey`, and `toPublic` output has no `secretKey`, `supabaseUrl` or link URLs.
- [ ] **Step 3:** `npx vitest run` → the new tests FAIL. **Step 4:** implement. **Step 5:** `npm test` → all PASS; `npm run build` and `npm run lint` clean.
- [ ] **Step 6: Commit** `feat(registry): serve communities from D1 with per-app roles`.

### Task 5: The check before saving

**Files:** Create `src/worker/check.ts`; Test `test/check.test.ts`.

**Interfaces:**

- Consumes: `probeFeatures` from `features.ts`.
- Produces: `type CheckStep = "url" | "unreachable" | "key" | "schema"` (in `types.ts`); `normalizeUrl(raw: string): string | null` (trim, lowercase, strip trailing `/`, then `^https://[a-z0-9]{20}\.supabase\.co$`); `checkCommunity(url: string, key: string, client?: (url: string, key: string) => SupabaseClient): Promise<{ ok: true; features: Features } | { ok: false; step: CheckStep }>`. The key is trimmed first; a `sb_publishable_` key fails at `key` without a request. Service role proof: `sb.auth.admin.listUsers({ page: 1, perPage: 1 })` (refused for anon/publishable keys); a fetch failure there is `unreachable`. Schema: `posts.id` and `profiles.id` both readable, else `schema`. Then `probeFeatures`.

- [ ] **Step 1: Failing tests** (stubbed client): `normalizeUrl(" https://ABCDEFGHIJKLMNOPQRST.supabase.co/ ")` → `"https://abcdefghijklmnopqrst.supabase.co"` (Review Focus 3); `normalizeUrl` refuses `http://…`, `https://x.supabase.co.evil.com`, a custom domain and a 19-char ref; a publishable key → `{ ok: false, step: "key" }` with the stub never called; `listUsers` error → `key`; a thrown `TypeError: fetch failed` → `unreachable`; missing `posts` (`42P01`) → `schema`; all good → `{ ok: true, features }`; the key reaching the stub is trimmed (`"  sb_secret_x\n"` → `"sb_secret_x"`, Review Focus 2).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(registry): check a Supabase URL and key before saving`.

### Task 6: Registry write routes

**Files:**

- Create: `src/worker/registryRoutes.ts`, `src/worker/settings.ts`, `src/shared/slug.ts`
- Modify: `src/worker/registry.ts` (writes + audit), `src/worker/router.ts` (delegate non-`/c/` paths; add the four Owner routes to `routes`), `src/shared/types.ts`
- Test: `test/registryRoutes.test.ts`, `test/settings.test.ts`, `test/slug.test.ts`

**Interfaces:**

- Consumes: Tasks 2–5.
- Produces (`src/shared/slug.ts`): `APP_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/`, `RESERVED_APP_IDS = ["api", "assets"]`, `slugify(name: string): string`.
- Produces (`settings.ts`): `parseSettings(x: unknown): CommunitySettings | { error: "bad_settings"; field: string }` — links are `null` or `https://…` containing `{id}`; topics as today's `parseCommunities` rules plus unique ids and `from < until` (`YYYY-MM-DD`); attachment types are strings.
- Produces (`types.ts`): `CommunitySettings`; `AccessRow { email; role; grantedBy; grantedAt }`; `AuditAction = "app_added" | "app_renamed" | "app_deleted" | "community_added" | "settings_changed" | "key_changed" | "community_removed" | "access_granted" | "access_changed" | "access_removed" | "imported"`; `AuditRow { at; actor; env: "prod"|"sandbox"|null; action: AuditAction; detail: Record<string, string> }`; `AppSummary { id; name; role: Role }`; `AppDetail extends AppSummary { communities: ("prod"|"sandbox")[]; access: AccessRow[]; audit: AuditRow[] }` (latest 20 audit rows).
- Produces (routes; every write and its audit row in one `DB.batch`):

| Route                                 | Role                                                                           | Body → result                                                                       | Errors                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/check`                     | any                                                                            | `{ supabaseUrl, secretKey }` → `{ features }`                                       | 422 `{ error: CheckStep }`                                                                                                                                         |
| `GET /api/apps`                       | any                                                                            | → `AppSummary[]` the caller can access                                              |                                                                                                                                                                    |
| `POST /api/communities`               | Owner of `app`, or anyone when `name` is given (new app, caller becomes Owner) | `{ app, name?, env, supabaseUrl, secretKey, confirmProd? }` → 201 `PublicCommunity` | 400 `bad_body`, `bad_app_id`, `confirm_prod`, `prod_in_preview`; 403 `forbidden`; 409 `app_taken`, `community_exists`, `project_taken`; 422 `{ error: CheckStep }` |
| `GET /api/apps/:app`                  | Owner                                                                          | → `AppDetail`                                                                       | 404 `not_found` (no role)                                                                                                                                          |
| `PATCH /api/apps/:app`                | Owner                                                                          | `{ name }` → `{ ok }`                                                               | 400 `bad_body`                                                                                                                                                     |
| `DELETE /api/apps/:app`               | admin                                                                          | → `{ ok }` (deletes its access rows too; audit kept)                                | 409 `has_communities`                                                                                                                                              |
| `PUT /api/apps/:app/access/:email`    | Owner                                                                          | `{ role }` → `{ ok }` (grant or change)                                             | 400 `bad_email`, `bad_role`; 409 `last_owner`                                                                                                                      |
| `DELETE /api/apps/:app/access/:email` | Owner                                                                          | → `{ ok }`                                                                          | 404 `not_found`; 409 `last_owner`                                                                                                                                  |
| `GET /api/c/:app/:env/settings`       | Owner                                                                          | → `{ supabaseUrl, settings: CommunitySettings }`                                    |                                                                                                                                                                    |
| `PUT /api/c/:app/:env/settings`       | Owner                                                                          | `CommunitySettings` → `{ ok }`                                                      | 400 `{ error: "bad_settings", field }`                                                                                                                             |
| `POST /api/c/:app/:env/key`           | Owner                                                                          | `{ secretKey }` → `{ ok }` after re-checking the stored URL                         | 422 `{ error: CheckStep }`                                                                                                                                         |
| `DELETE /api/c/:app/:env/community`   | Owner                                                                          | → `{ ok }` (row and key gone; the community's own database untouched)               |                                                                                                                                                                    |

The last-owner guard is one statement (`… WHERE NOT (role = 'owner' AND (SELECT count(*) FROM access WHERE app = ? AND role = 'owner') = 1)`) checked through `meta.changes`, so two concurrent removals can't both pass. A new community's settings start as `{ amplitudeUserUrl: null, revenuecatCustomerUrl: null, topics: [], attachmentTypes: [] }`. Audit `detail` holds e.g. `{ email, role }` or `{ field }`, never a key or URL template value.

- [ ] **Step 1: Failing tests** (`test/registryRoutes.test.ts`, stubbing `checkCommunity`): a new app makes the caller Owner and writes `app_added` + `community_added`; adding to an existing app as Editor → 403; `env: "prod"` without `confirmProd` → 400 `confirm_prod`; in a preview → 400 `prod_in_preview`; the same URL under another app → 409 `project_taken`, including when the UNIQUE violation comes from the insert itself (two adds racing, Review Focus 4); `app: "api"` / `"Bad Id"` → `bad_app_id`, an existing id with `name` → `app_taken` (Review Focus 5); granting `x@gmail.com` → 400 `bad_email`; granting `Stan@Rocapine.com` stores `stan@rocapine.com`; removing or downgrading the last Owner → 409 `last_owner`, an admin can still add a new Owner; `DELETE /api/apps/:app` as Owner (not admin) → 403, as admin with a community → 409 `has_communities`, without → ok and audit rows still there; `GET /api/apps/:app` as Editor → 403; key change with a failing check leaves the old ciphertext in place; no audit row's `detail` and no response body contains the secret key string (scan every response and the whole `audit` table). `test/settings.test.ts`: duplicate topic id, `from` after `until`, `http://` link, link without `{id}` → each `bad_settings` with its `field`. `test/slug.test.ts`: `slugify("Eve's Rhythm") === "eves-rhythm"`, `slugify("  Nightward 2 ")` → `"nightward-2"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS; build and lint clean.
- [ ] **Step 5: Commit** `feat(registry): add communities, settings, keys and access from the API`.

### Task 7: One-off import from `COMMUNITIES`

**Files:** Modify `src/worker/registryRoutes.ts`, `src/worker/communities.ts`; Test `test/import.test.ts`.

**Interfaces:**

- Consumes: `parseCommunities` / `LegacyCommunity` (legacy), `encryptKey`, `parseSettings`, registry writes.
- Produces: `Me` gains `canImport: boolean`. `POST /api/admin/import` (admins only, else 403) → `{ imported: string[]; skipped: string[] }` (`"app/env"` labels). For each legacy entry: skip prod in a preview, skip rows already in D1 (idempotent), read `env[keySecret]` (missing → skipped), create the app if missing (`created_by` = caller, **no access row**: spec "Access at cutover"), insert the community with its settings, audit `imported`. `GET /api/me` gains `canImport: boolean` (admin, `COMMUNITIES` set, and at least one entry not yet in D1).

- [ ] **Step 1: Failing tests:** two legacy entries → both imported with every setting kept (topics with `from`/`until`, attachment types, both links) and decrypted keys equal to the secrets; a second call → both skipped; in a preview → prod skipped; non-admin → 403; no access rows created; `canImport` flips to false after import.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(registry): import the COMMUNITIES config into D1`.

### Task 8: SPA — roles, no-access screen, switcher entries

**Files:**

- Modify: `src/app/community.ts`, `src/app/App.tsx`, `src/app/shell/CommunitySwitcher.tsx`, and the action sites: `composer/DraftsMenu.tsx`, `composer/ComposerDock.tsx` (keyboard shortcut), `shell/ScheduledWeek.tsx`, `queue/QueuePage.tsx` (keys H, R, B and the reply-as-team), `queue/ActionBar.tsx`, `members/MemberPanel.tsx` (AdminSwitch, Ban, Unban, edit team account), `members/MembersPage.tsx` / `MembersList.tsx` (new team account)
- Create: `src/app/registry/NoAccess.tsx`, `src/app/shared/ViewerTip.tsx`
- Test: `test/viewer.test.tsx`, `test/noAccess.test.tsx`

**Interfaces:**

- Consumes: `PublicCommunity.role`, `Me` (Task 4), `canImport` (Task 7).
- Produces: `useMe()` returns `Me`; `useCanEdit(): boolean` (`useCommunity().role !== "viewer"`); `ViewerTip({ children })` wraps a disabled control in the tooltip "Viewers can't change anything"; `useApps()` → `AppSummary[]`; switcher items "Add a community" (everyone) and "Community settings" (Owner of the current app) that open the sheets of Tasks 9 and 10 through `openAddCommunity()` / `openSettings()` from a small context `RegistrySheetsProvider` in `src/app/registry/sheets.tsx`.
- Viewer: the New post button and composer are hidden (DraftsMenu not rendered, composer shortcut off, scheduled drafts not openable); queue and member actions disabled inside `ViewerTip`; keyboard actions do nothing.
- No access: `RootRedirect` with an empty list renders `NoAccess`: "You don't have access to any community yet." then "Ask the owner of the app, or" + the admins' emails, an "Add a community" button, and for `canImport` an "Import communities from config" button (calls Task 7, then refetches).

- [ ] **Step 1: Failing tests:** with a viewer community, no "New post" button, the queue's Hide button is disabled and pressing `h` posts nothing, the member panel's Ban is disabled with the tooltip text; with an editor community all of them work as today; the empty list renders `NoAccess` with both admins' emails and "Add a community"; `canImport` shows the import button and a click calls `POST /api/admin/import`; the switcher shows "Community settings" only for an Owner.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(app): per-app roles in the UI and a no-access screen`.

### Task 9: SPA — Add a community sheet

**Files:** Create `src/app/registry/AddCommunitySheet.tsx`; modify `src/app/registry/sheets.tsx`; Test `test/addCommunity.test.tsx`.

**Interfaces:**

- Consumes: `useApps()`, `slugify`, `APP_ID`, `POST /api/communities`, the check copy (Global Constraints).
- Produces: a right-side `Sheet` with: App (select of the apps the caller owns, plus "New app" → Name, then Id prefilled by `slugify(name)` and editable), Environment (Sandbox / Production), Supabase URL, Secret key (`type="password"`, `autoComplete="off"`). Submit "Check and add". Production asks the confirm (`AlertDialog`, exact copy) before sending `confirmProd: true`. A failed step shows its exact copy next to the field it concerns (url → URL, key → key, schema/unreachable → under the form). On success: invalidate `communities` and `apps`, close, navigate to the new community.

- [ ] **Step 1: Failing tests:** typing "Eve's Rhythm" prefills id `eves-rhythm`; a 422 `schema` shows "No community schema here: run the SDK's migrations first."; a 409 `project_taken` shows "This project is already in the dashboard."; choosing Production opens the confirm and nothing is sent until "Add"; the key field is a password input and its value is cleared when the sheet closes.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(app): add a community from the switcher`.

### Task 10: SPA — Community settings sheet

**Files:** Create `src/app/registry/SettingsSheet.tsx`, `src/app/registry/TopicsEditor.tsx`, `src/app/registry/AccessList.tsx`; modify `sheets.tsx`; Test `test/settingsSheet.test.tsx`, `test/topicsEditor.test.tsx`.

**Interfaces:**

- Consumes: `GET/PATCH /api/apps/:app`, `PUT/DELETE …/access/:email`, `GET/PUT …/settings`, `POST …/key`, `DELETE …/community`, `DELETE /api/apps/:app`; attachment types offered from the SPA's attachment registry (`src/app/attachments/types.ts`).
- Produces: a wide right-side `Sheet`, sections in order: **App** (name, saved on blur/Enter); **This community** (RevenueCat and Amplitude links, attachment types as checkboxes, Save); **Topics** (`TopicsEditor`: rows of id, label, admin only, from, until; add, remove, reorder up/down; Save); **Key** ("Change key": a password field + "Check and replace"; the key is never shown); **Access** (`AccessList`: email, role select, remove; "Add someone": email + role); **Recent changes** (the 20 audit rows: who, what, when); **Danger** ("Remove this community", enabled only once the community's name is typed; for an admin, "Delete app" once no community is left). Server errors show the exact copy; `last_owner` → "An app needs at least one owner."

- [ ] **Step 1: Failing tests:** removing the community stays disabled until the typed text equals the name; a role change sends `PUT …/access/<encoded email>` with `{ role }`; a 409 `last_owner` shows its copy and the select reverts; adding a topic with an existing id is refused in the editor before saving; a 400 `bad_settings` with `field: "topics"` marks the Topics section; "Change key" with a 422 `key` shows "This key can't read the database." and keeps the field's value for a retry; "Delete app" is absent for a non-admin.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS; build and lint clean.
- [ ] **Step 5: Commit** `feat(app): community settings, topics and access in one sheet`.

### Task 11: Config, local run and end-to-end check

**Files:** Modify `wrangler.jsonc`, `.dev.vars.example`, `CLAUDE.md`.

- [ ] **Step 1: Config.** Top level: `"d1_databases": [{ "binding": "DB", "database_name": "community-dashboard", "database_id": "<id>", "migrations_dir": "migrations" }]`; vars `DASHBOARD_ADMINS` (Guillaume's and Stan's `@rocapine.com` addresses), `MASTER_KEY_VERSION: "1"`; `COMMUNITIES` stays until Task 12. `previews`: its own `d1_databases` (`community-dashboard-preview`), the same `DASHBOARD_ADMINS` and `MASTER_KEY_VERSION`, and `PREVIEW: "1"`. Keep the comment about previews being sandbox only. `.dev.vars.example` gains `MASTER_KEY_V1=` (any `openssl rand -base64 32` for local). `CLAUDE.md`: the key rule now says "keys are encrypted in D1 and decrypted only in the Worker", plus the D1 migration command.
- [ ] **Step 2: Local run.** `npx wrangler d1 migrations apply DB --local`, `npm run build`, `npx wrangler dev` with `DEV_ACCESS_EMAIL` set to an admin. Import from config (Unchaind sandbox), then: the switcher lists only Unchaind sandbox; add the sandbox again → "This project is already in the dashboard."; grant a second `@rocapine.com` address Viewer, switch `DEV_ACCESS_EMAIL` to it → actions disabled, settings absent, write via `curl` → 403; edit a topic label and see it in the composer's topic picker; change the key to a wrong one → refused, old key still works. No prod: agents never use the prod key.
- [ ] **Step 3:** `npm test`, `npm run build`, `npm run lint` → clean.
- [ ] **Step 4: Commit** `chore: D1 bindings, admins and master key config`.
- [ ] **Step 5: PR.** Walkthrough video (Playwright WebKit, as for brick 7): no-access screen → import → add sandbox → settings sheet (topics, access) → viewer view. PR body lists the Cloudflare steps from "Before Task 1" and the deploy order: create DBs and secrets → `npx wrangler d1 migrations apply community-dashboard --remote` (and the preview DB) → merge → an admin clicks "Import communities from config" on community.rocapi.ne → check both Unchaind communities work. Wait for Guillaume's test and OK before merging.

### Task 12: Remove the old config (after the production import)

Runs only once Guillaume confirms the import worked in production. Its own small PR.

**Files:** Modify `wrangler.jsonc`, `src/worker/env.ts`, `src/worker/registryRoutes.ts`, `src/app/registry/NoAccess.tsx`, `src/app/community.ts`; delete `src/worker/communities.ts`, `test/communities.test.ts`, `test/import.test.ts`; in this SDK repo, `docs/dashboard-roadmap.md`.

- [ ] **Step 1:** Remove `COMMUNITIES` (both blocks), the import route, `canImport` and its button. `npm test`, build, lint clean.
- [ ] **Step 2:** Guillaume deletes the old secrets: `npx wrangler secret delete SUPABASE_KEY_UNCHAIND_PROD`, `npx wrangler secret delete SUPABASE_KEY_UNCHAIND_SANDBOX`, and the Previews one in the dashboard.
- [ ] **Step 3:** Roadmap (SDK repo): brick 13 `done` with the PR links.
- [ ] **Step 4: Commit** `chore: drop the COMMUNITIES config`; PR; merge after Guillaume's OK.
