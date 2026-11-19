# Community dashboard, brick 13: communities and access

Status: draft 2026-11-13, waiting for Guillaume's review. It replaces the roadmap's brick 13 ("Dashboard
roles") and moves it ahead of bricks 8 and 6 (brick 5 has shipped). Guillaume skipped the general
questions, so the calls marked "my call" are the builder's choices for him to check.

## Why

The dashboard is about to open to colleagues who run other apps on the Community SDK. Two things stop
that today:

- **Adding a community needs a developer.** The list of communities is the `COMMUNITIES` var in
  `wrangler.jsonc`, so adding an app, or even a topic, is a PR. Its Supabase key is a Worker secret,
  set with `wrangler secret put` by someone with access to the Cloudflare account.
- **Everyone sees everything.** Cloudflare Access lets in any `@rocapine.com` account, and the Worker
  then serves every community to everyone. A colleague who works on one app would see, moderate and
  post in all of them, production included.

## Goals

- A Rocapinian adds a community (an app and its environment) from the dashboard: Supabase URL, secret
  key and the community's settings. The dashboard checks the key and the schema before saving.
- Each person sees only the apps they were given, with a role per app. Every rule is enforced by the
  Worker on every request. The browser only hides what the role can't do.
- The owner of an app manages who has access to it, from the dashboard.
- The dashboard admins (Guillaume and Stan to start with) can see and manage every app.

## Non-goals

- Sign-in. Cloudflare Access with Google (`@rocapine.com`) stays as it is. People outside Rocapine
  never get in.
- Topics in the app's database (brick 9). The dashboard keeps its own copy of each community's
  topics, now editable here instead of in code.
- The read-only community view of brick 8 (cron runs, Edge Functions, secrets). Only the check made
  when a community is added or its key is changed comes from it.
- Fine-grained permissions (per screen, per action). Three roles.
- Notifications to people who are given access.

## Anti-goals

- A Supabase secret key readable by a browser, in a log, in a PR preview or in plain text in the
  database.
- A preview of an unmerged PR able to reach a production community. Previews stay sandbox only, as
  today.
- Being locked out: no state where nobody can manage an app or the dashboard.
- Confusing the dashboard's roles with the community's own admins (`profiles.is_admin`, brick 3).
  They are different words in the UI.

## Decisions

### Model

- An **app** is what people get access to (my call: per app, covering its environments, since the
  same people moderate the sandbox and production). A **community** is an app in one environment,
  `prod` or `sandbox`, as today: its URL is still `/c/<app>/<env>`.
- **Roles per app** (my call: three, named to avoid "admin"):
  - **Viewer**: sees everything in the app's communities, changes nothing.
  - **Editor**: everything the dashboard does on community content today. That covers the review
    queue, members (ban, make community admin), team accounts, composer, drafts, publishing and
    scheduling.
  - **Owner**: Editor, plus the app's settings, its communities (add, edit, change key, remove) and
    its access list.
- **Dashboard admins**: a list of emails in the Worker's config (a `DASHBOARD_ADMINS` var). They are
  Owner of every app, see every app, and are the only ones who can delete an app. A var, not a
  table, so access can always be repaired with a deploy. At launch there are two: Guillaume and Stan.
- **Who can add an app** (my call): any Rocapinian. They become its Owner. An app nobody added stays
  invisible to everyone but the dashboard admins.
- **An app's id** (my call) is the slug in its URLs. It is derived from the name, can be edited while
  adding the app, and is fixed afterwards. A taken id or an already registered Supabase project gets a
  plain refusal ("This id is taken", "This project is already in the dashboard"); that it reveals an
  app exists is acceptable inside Rocapine.
- **The name belongs to the app** (my call): its communities show the app's name, as Unchaind does
  today for both environments. An app may have only a sandbox, only a production, or both.
- **Deleting** (my call): an Owner removes a community; the app stays, with its access list, even
  with no community left. Only a dashboard admin deletes an app, once it has no community. Audit rows
  are never deleted: they keep the app id as text, with no cascade.

### Storage

- A **D1 database** bound to the Worker holds apps, communities, access and an audit log:
  - `apps`: id (the slug used in URLs), name, created_by, created_at;
  - `communities`: app, env, Supabase URL, the encrypted secret key, the settings `COMMUNITIES` holds
    today (topics, attachment types, RevenueCat and Amplitude URLs), updated_by, updated_at;
  - `access`: app, email (lowercased), role, granted_by, granted_at;
  - `audit`: who did what to which app or community, when (app added, community added or edited,
    key changed, community removed, access granted, changed or removed). Never the key.
- **The secret key is encrypted** (AES-GCM) with a master key held as a Worker secret. Each row
  records the master key's version, so the master key can be rotated later (my call). It is
  decrypted only in the Worker, for the request that needs it. The API never returns it, not even
  masked. Changing it means pasting a new one.
- **Previews** get their own D1 database and their own master key, and the Worker refuses a `prod`
  community when it runs as a preview (a var set only in `previews.vars`). A preview can't reach
  production, as today with the Previews secrets (my call: enforced in code, not left to convention).
- **Moving from today's config** (my call): a one-off import, run once by a dashboard admin, copies
  each `COMMUNITIES` entry and its Worker secret into D1. All of Unchaind's settings are kept. The
  Worker then reads only D1. `COMMUNITIES` and the `SUPABASE_KEY_*` secrets are removed after a
  check, in the same PR or right after it. The builder picks the mechanism (an admin-only route, a
  script).
- **Access at cutover:** Unchaind gets no access rows. The only people on it are Guillaume and Stan,
  who reach it as dashboard admins. Nobody else sees anything until an Owner or an admin adds them.

### Adding a community

- **From the community switcher:** "Add a community". It opens a sheet, not a page (UI principles),
  with: app (an existing app the person owns, or a new one with its name), environment, Supabase URL,
  secret key.
- **Check before saving**, in the Worker:
  - the URL is exactly `https://<project-ref>.supabase.co` (my call: no custom domain, so the Worker
    never sends a key anywhere else; `wrangler dev` may also allow a local Supabase);
  - the key opens the database as the service role (a service-only query, not an anon or publishable
    key);
  - the SDK schema is there (`profiles`, `posts`);
  - the modules installed are listed (the existing `probeFeatures`).
    A failure says which step failed, in plain words ("This key can't read the database", "No community
    schema here: run the SDK's migrations first"). Nothing is saved.
- **Production** asks for one extra confirmation ("This is a production community: real members will
  see what is published from here").
- **The same URL can't be added twice**, even in another app.

### Settings and access

- **Each community gets a settings sheet**, from the switcher or the sidebar, for Owners. It shows:
  - Name, RevenueCat and Amplitude links, attachment types.
  - **Topics**: a list editor (id, label, admin only, event dates from/until, order). Same fields as
    today's config.
  - The key: "Change key" runs the check again before replacing it. The key itself is never shown.
  - "Remove this community", confirmed by typing its name. It deletes the key. Nothing in the
    community's own database is touched.
- **Access is managed per app, in the same sheet:**
  - The list of people with their role.
  - "Add someone": email and role. The person doesn't need to have signed in before.
  - Change a role, remove someone.
  - An app always keeps at least one Owner, so the last one can't be removed or downgraded. Dashboard
    admins can always fix an app.
  - Only `@rocapine.com` emails, checked by the Worker.
- **Every change goes to the audit log.** The sheet shows the latest entries for the app, to its
  Owners and the dashboard admins only (my call).

### What each person sees

- The switcher and Home list only the communities of the apps the person can access.
- With no access at all: one screen saying who to ask, and "Add a community".
- A Viewer sees the same screens with the actions turned off. The New post button and composer are
  hidden. Queue and member actions are disabled. Their tooltip says "Viewers can't change anything".
- A request outside the person's role gets 403 `forbidden`, whatever the browser does.

### Worker

- `route()` in `src/worker/router.ts` stays the single entry point. After `verifyAccess` (email from
  Access, unchanged), it loads the community from D1 and the person's role for its app. It then
  checks the route against the role: GET routes need Viewer, writes need Editor, settings and access
  routes need Owner.
- `GET communities` returns only what the person can see, with their role per app. `GET me` adds
  whether they are a dashboard admin.
- `clientFor` decrypts the key from D1 instead of reading a Worker secret.
- New routes for apps, communities (add, check, edit, change key, remove), access and audit. Writes
  are JSON-only and checked for same-origin, as today.

## Constraints

- No SDK change.
- Cloudflare: the Worker is on the Rocapine account. D1 and the new secrets are created by whoever has
  Cloudflare access. The builder lists the exact commands. Guillaume runs those that need his
  account, or allows them.
- Production communities are read-only for agents while building. Tests use the Unchaind sandbox and
  D1 locally (`wrangler dev`).
- UI copy in English, no hint text under fields, calm UI. Production keeps its orange mark.

## Left to the builder

- The D1 schema details, migrations (`wrangler d1 migrations`) and indexes.
- How the import from `COMMUNITIES` runs.
- The exact service-only query used to prove the key is a secret key.
- Component structure of the sheets, and where the settings entry sits (switcher or sidebar).
- Whether the role table lives in one module (`src/worker/access.ts` or a new `roles.ts`).

## Roadmap

- Brick 13 becomes "Communities and access", moves into "Next", and comes before 8 and 6.
- Brick 8 loses its "check when adding" part to this brick and keeps the read-only community view.
- The roadmap's "Decided" section gets: the dashboard opens to Rocapinians per app; anyone can add an
  app and owns it; dashboard admins in config.
