# Post & Comment Auto-Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `translation` module to the community SDK so posts, comments and poll options are translated at publication into the app's declared locales and shown in the reader's language with a per-item "see original" toggle; comment pushes, official-post broadcasts and inbox excerpts follow the recipient's language.

**Architecture:** Three additive Supabase tables filled by a `translate-one` Edge Function (triggered by pg_net when an item becomes `visible`) and a daily `daily-translation` sweep, both built on a shared `_shared/translation.ts` (one OpenAI structured-output call per item, all target locales). The core package embeds the reader-locale translation rows in its existing selects and exposes them as `translation` fields next to the untouched original `text`; the UI decides what to display. Same module pattern as push/polls/reaction/inbox, installed by the CLI.

**Tech Stack:** TypeScript (npm workspaces, vitest), Supabase (Postgres 15, pg_net, pg_cron, Deno Edge Functions on `jsr:@supabase/supabase-js@2`), OpenAI Responses API with JSON schema output, React Native (Expo) for the UI package. Prettier enforced by CI.

**Spec:** `docs/superpowers/specs/2026-09-23-post-translation-design.md` — read it first; every task below argues from it.

## Global Constraints

- Module id is `translation`, last in `MODULE_ORDER` (`["core","push","polls","reaction","inbox","translation"]`).
- Client config field: `modules.translation?: { locales: string[] } | false` (optional key; absent = off).
- Backend secrets: `COMMUNITY_TRANSLATION_LOCALES` (required when the module is on, comma-separated, must equal the client list), `COMMUNITY_TRANSLATION_MODEL` (optional, default `gpt-5-mini`), `COMMUNITY_TRANSLATION_STYLE` (optional), `OPENAI_API_KEY` (already required).
- `FeedPost.text` / `ThreadComment.text` / `PollOption.label` ALWAYS hold the original; translations live in `FeedPost.translation`, `ThreadComment.translation`, `PollOption.translatedLabel`.
- Without the module (or without a resolvable reader locale) every query, type and screen must be byte-identical to today's behaviour.
- No translation row is ever written for a locale whose language equals the detected source language.
- Trigger bodies are untrusted: functions only read `kind` and `id` and re-read the row.
- Migration templates use the `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__` placeholders (the CLI substitutes them); guard anything touching `poll_options` with `if to_regclass('public.poll_options') is not null`.
- Every task ends with `npm run build && npm run typecheck && npm test && npx prettier --check .` green (run from the repo root; functions additionally `deno check`).
- Commits: conventional messages, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on branch `feat/translation`.
- Working directory for all commands: `/Users/glsx/Developer/community-sdk`. Deno is not installed globally: use `npx -y deno@2` with the config `{"compilerOptions":{"lib":["deno.window"],"strict":true}}` written to a scratch file (see Task 2).

---

## File structure

**Backend templates (`supabase/`)**
- Create `supabase/migrations/translation/001_translations.sql` — tables, RLS, triggers, cron, sweep helper.
- Create `supabase/functions/_shared/translation.ts` — secrets, OpenAI call, response parser, `ensureTranslations`, `resolveTargetLocale`.
- Create `supabase/functions/_shared/translation_test.ts` — Deno unit tests for the pure parts.
- Create `supabase/functions/translate-one/index.ts`, `supabase/functions/daily-translation/index.ts`.
- Modify `supabase/functions/notify-comment/index.ts`, `supabase/functions/broadcast-post/index.ts` — localized excerpts.

**CLI (`packages/cli`)**
- Modify `src/install-shared.ts` (module order, functions map, dependency warning), `src/commands/init.ts` (secrets hint), tests.

**Core (`packages/core/src`)**
- Create `locale.ts` — `readerLocale(cfg)`; test `__tests__/locale.test.ts`.
- Modify `config.ts` (module type), `models.ts` (row + model types, mapping), `service.ts` (selects + embedded filters), `hooks.ts` (locale in query keys), `inbox-service.ts` (excerpt substitution), `events.ts`, `index.ts`, tests.

**UI (`packages/ui/src`)**
- Create `utils/translation.ts` — `displayText`, `translationLine`; test `__tests__/translation.test.ts`.
- Modify `components/CommunityPost.tsx`, `components/PollBlock.tsx`, `screens/ThreadSheet.tsx` (CommentRow), all 9 `locales/*.ts`.

**Docs / release**
- Modify `README.md` (module matrix), `docs/backend-runbook.md` (secrets), `docs/compat.md`, `packages/core/README.md`, `packages/ui/README.md`; add three changesets; `.github/workflows/ci.yml` (deno test step).

---

### Task 1: Migration template and CLI module registration

**Files:**
- Create: `supabase/migrations/translation/001_translations.sql`
- Modify: `packages/cli/src/install-shared.ts:16-33` (MODULE_ORDER, functions map), `packages/cli/src/install-shared.ts:61-64` (warning), `packages/cli/src/commands/init.ts:176-184` (secrets hint)
- Test: `packages/cli/src/__tests__/init.test.ts`

**Interfaces:**
- Produces: tables `post_translations(post_id, locale, source_locale, content, engine, created_at)`, `comment_translations(comment_id, …)`, `poll_option_translations(option_id, locale, content)`; SQL function `items_missing_translations(kind text, target_locales text[], max_items int) returns table(id uuid)`; triggers calling `/functions/v1/translate-one` with body `{"kind": "post"|"comment", "id": "<uuid>"}`; cron `community-translation-sweep` → `/functions/v1/daily-translation` at `30 8 * * *`. CLI module `"translation"` with functions `translate-one`, `daily-translation`.

- [ ] **Step 1: Write the failing CLI tests**

Append to `packages/cli/src/__tests__/init.test.ts` inside the `runInit` describe block:

```ts
  it("installs the translation module last, with its two functions", async () => {
    await runInit(baseOptions({ modules: ["core", "polls", "translation"] }));
    const files = fs.readdirSync(path.join(cwd, "supabase", "migrations")).sort();
    const modulesInFileOrder = files.map((f) => f.split("_community_")[1]!.split("_")[0]);
    expect(modulesInFileOrder.at(-1)).toBe("translation");
    expect(modulesInFileOrder.filter((m) => m === "translation")).toHaveLength(1);
    const fnDirs = fs.readdirSync(path.join(cwd, "supabase", "functions")).sort();
    expect(fnDirs).toContain("translate-one");
    expect(fnDirs).toContain("daily-translation");
  });

  it("warns when translation is selected without polls, but proceeds", async () => {
    const onWarn = vi.fn();
    const result = await runInit(baseOptions({ modules: ["core", "translation"], onWarn }));
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toMatch(/poll/i);
    expect(result.manifest.modules).toEqual(["core", "translation"]);
  });
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run: `npm test -w @rocapine/community 2>&1 | grep -E "×|Tests "`
Expected: the two new tests fail (`unknown module "translation"`).

- [ ] **Step 3: Write the migration template**

Create `supabase/migrations/translation/001_translations.sql`:

```sql
-- Translation module: posts, comments and poll option labels translated at
-- publication into the app's declared locales (COMMUNITY_TRANSLATION_LOCALES
-- secret, mirrored by the client's modules.translation.locales), shown in the
-- reader's language by @rocapine/community-ui with a per-item "see original".
--
-- Written only by the service role (translate-one / daily-translation Edge
-- Functions). Readable exactly where the parent row is readable (RLS on
-- posts/comments does the filtering, same pattern as likes). Additive: no
-- core table changes. poll_option_translations is guarded so this module
-- installs on a backend without the polls module.

create table public.post_translations (
  post_id       uuid not null references public.posts(id) on delete cascade,
  locale        text not null,
  source_locale text not null,
  content       text not null,
  engine        text not null,
  created_at    timestamptz not null default now(),
  primary key (post_id, locale)
);
alter table public.post_translations enable row level security;
create policy "post translations readable where post readable"
  on public.post_translations for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_translations.post_id));
grant select on public.post_translations to anon, authenticated;

create table public.comment_translations (
  comment_id    uuid not null references public.comments(id) on delete cascade,
  locale        text not null,
  source_locale text not null,
  content       text not null,
  engine        text not null,
  created_at    timestamptz not null default now(),
  primary key (comment_id, locale)
);
alter table public.comment_translations enable row level security;
create policy "comment translations readable where comment readable"
  on public.comment_translations for select to anon, authenticated
  using (exists (select 1 from public.comments c where c.id = comment_translations.comment_id));
grant select on public.comment_translations to anon, authenticated;

do $$
begin
  if to_regclass('public.poll_options') is not null then
    create table if not exists public.poll_option_translations (
      option_id uuid not null references public.poll_options(id) on delete cascade,
      locale    text not null,
      content   text not null,
      primary key (option_id, locale)
    );
    alter table public.poll_option_translations enable row level security;
    drop policy if exists "poll option translations readable where option readable"
      on public.poll_option_translations;
    create policy "poll option translations readable where option readable"
      on public.poll_option_translations for select to anon, authenticated
      using (exists (select 1 from public.poll_options o where o.id = poll_option_translations.option_id));
    grant select on public.poll_option_translations to anon, authenticated;
  end if;
end $$;

-- ============ SWEEP HELPER ============
-- Visible items that lack at least one target locale other than their own
-- source language. Items with no translation row at all have an unknown
-- source and are always returned. Service role only.
create or replace function public.items_missing_translations(
  kind text, target_locales text[], max_items int
) returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select x.id from (
    select p.id, p.created_at,
      (select array_agg(t.locale) from public.post_translations t where t.post_id = p.id) as have,
      (select min(t.source_locale) from public.post_translations t where t.post_id = p.id) as src
    from public.posts p where kind = 'post' and p.status = 'visible'
    union all
    select c.id, c.created_at,
      (select array_agg(t.locale) from public.comment_translations t where t.comment_id = c.id) as have,
      (select min(t.source_locale) from public.comment_translations t where t.comment_id = c.id) as src
    from public.comments c where kind = 'comment' and c.status = 'visible'
  ) x
  where x.have is null
     or exists (
       select 1 from unnest(target_locales) l
       where split_part(l, '-', 1) <> x.src and not (l = any (x.have))
     )
  order by x.created_at desc
  limit max_items
$$;
revoke execute on function public.items_missing_translations(text, text[], int) from public, anon, authenticated;
grant execute on function public.items_missing_translations(text, text[], int) to service_role;

-- ============ TRIGGERS ============
create or replace function public.translate_post_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/translate-one',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('kind', 'post', 'id', new.id)
  );
  return new;
end; $$;

create or replace function public.translate_comment_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/translate-one',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('kind', 'comment', 'id', new.id)
  );
  return new;
end; $$;

drop trigger if exists on_post_published_translate on public.posts;
create trigger on_post_published_translate
  after update of status on public.posts for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_post_webhook();
drop trigger if exists on_post_created_visible_translate on public.posts;
create trigger on_post_created_visible_translate
  after insert on public.posts for each row
  when (new.status = 'visible')
  execute function public.translate_post_webhook();

drop trigger if exists on_comment_published_translate on public.comments;
create trigger on_comment_published_translate
  after update of status on public.comments for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_comment_webhook();
drop trigger if exists on_comment_created_visible_translate on public.comments;
create trigger on_comment_created_visible_translate
  after insert on public.comments for each row
  when (new.status = 'visible')
  execute function public.translate_comment_webhook();

-- ============ CRON ============
-- Daily sweep at 08:30 UTC (after the 08:00 moderation sweep): back-fills the
-- history on first installation, then catches anything translate-one missed.
do $$
begin
  perform cron.schedule(
    'community-translation-sweep',
    '30 8 * * *',
    $cron$
    select net.http_post(
      url := '__SUPABASE_PROJECT_URL__/functions/v1/daily-translation',
      headers := jsonb_build_object('Authorization', 'Bearer __SUPABASE_ANON_KEY__')
    );
    $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job community-translation-sweep already scheduled, skipping';
  else
    raise;
  end if;
end $$;
```

- [ ] **Step 4: Register the module in the CLI**

In `packages/cli/src/install-shared.ts` replace the module order and functions map:

```ts
export const MODULE_ORDER = ["core", "push", "polls", "reaction", "inbox", "translation"] as const;
```

and, next to `REACTION_FUNCTIONS`:

```ts
const TRANSLATION_FUNCTIONS = ["translate-one", "daily-translation"];
```

and in `functionsForModules`, after the reaction line:

```ts
  if (modules.includes("translation")) for (const f of TRANSLATION_FUNCTIONS) set.add(f);
```

After the existing inbox-without-reaction warning (line 61-64) add:

```ts
  if (canonicalModules.includes("translation") && !canonicalModules.includes("polls")) {
    onWarn(
      "community-sdk: module 'translation' selected without 'polls' — poll option labels won't be translated (posts and comments are).",
    );
  }
```

Also update the header comment of `MODULE_ORDER` to mention `inbox -> translation`.

In `packages/cli/src/commands/init.ts`, after the push-module secrets hint (line 179-183) add:

```ts
  if (modules.includes("translation")) {
    log(
      '     translation module: COMMUNITY_TRANSLATION_LOCALES="en,es-419,..." (required, same list as modules.translation.locales in the app); optional: COMMUNITY_TRANSLATION_MODEL, COMMUNITY_TRANSLATION_STYLE',
    );
  }
```

- [ ] **Step 5: Run the CLI tests to verify they pass**

Run: `npm run build -w @rocapine/community && npm test -w @rocapine/community 2>&1 | grep -E "×|Tests "`
Expected: all pass. If the fixture that counts migration files with every module (`orders copied migrations core -> push -> polls -> reaction -> inbox`) now fails because it does not request `translation`, leave it (it lists modules explicitly, so it should still pass).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/translation packages/cli
git commit -m "feat(backend,cli): translation module — tables, RLS, triggers, sweep helper, CLI registration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared translation helper (`_shared/translation.ts`) with Deno tests and CI step

**Files:**
- Create: `supabase/functions/_shared/translation.ts`, `supabase/functions/_shared/translation_test.ts`, `supabase/functions/deno.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces:
  - `TARGET_LOCALES: string[]` (from `COMMUNITY_TRANSLATION_LOCALES`), `TRANSLATION_MODEL: string`, `TRANSLATION_STYLE: string`.
  - `languageOf(locale: string): string` — `"es-419"` → `"es"`.
  - `resolveTargetLocale(profileLocale: string | null | undefined, targets = TARGET_LOCALES): string | null`.
  - `parseTranslationResponse(raw: unknown, targets: string[], optionCount: number): ParsedTranslation | null` where `ParsedTranslation = { sourceLocale: string; translations: Record<string, { content: string; options: string[] }> }` (keys = target locales whose language differs from the source).
  - `ensureTranslations(supabase, kind: "post" | "comment", id: string): Promise<TranslationRow[] | null>` where `TranslationRow = { locale: string; source_locale: string; content: string }` (empty array = item is in a target language / nothing to translate; `null` = failure, nothing written).

- [ ] **Step 1: Write the failing Deno tests**

Create `supabase/functions/deno.json`:

```json
{ "compilerOptions": { "lib": ["deno.window"], "strict": true } }
```

Create `supabase/functions/_shared/translation_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { languageOf, parseTranslationResponse, resolveTargetLocale } from "./translation.ts";

const TARGETS = ["en", "es-ES", "es-419", "pt-PT", "pl"];

Deno.test("languageOf strips the region", () => {
  assertEquals(languageOf("es-419"), "es");
  assertEquals(languageOf("EN"), "en");
});

Deno.test("resolveTargetLocale: exact, same-language, none", () => {
  assertEquals(resolveTargetLocale("es-419", TARGETS), "es-419");
  assertEquals(resolveTargetLocale("es-MX", TARGETS), "es-ES");
  assertEquals(resolveTargetLocale("pt-BR", TARGETS), "pt-PT");
  assertEquals(resolveTargetLocale("fr", TARGETS), null);
  assertEquals(resolveTargetLocale(null, TARGETS), null);
});

Deno.test("parseTranslationResponse keeps only targets in another language and drops bad shapes", () => {
  const parsed = parseTranslationResponse(
    {
      source_locale: "en",
      translations: {
        en: { content: "same language, must be dropped", options: [] },
        "es-ES": { content: "Hola", options: ["Sí", "No"] },
        "es-419": { content: "Hola", options: ["Sí", "No"] },
        "pt-PT": { content: "Olá", options: ["Sim"] }, // wrong option count → dropped
        fr: { content: "not a target", options: [] },
      },
    },
    TARGETS,
    2,
  );
  assertEquals(parsed?.sourceLocale, "en");
  assertEquals(Object.keys(parsed!.translations).sort(), ["es-419", "es-ES"]);
  assertEquals(parsed!.translations["es-ES"].options, ["Sí", "No"]);
});

Deno.test("parseTranslationResponse rejects invalid payloads", () => {
  assertEquals(parseTranslationResponse(null, TARGETS, 0), null);
  assertEquals(parseTranslationResponse({ translations: {} }, TARGETS, 0), null);
  assertEquals(parseTranslationResponse({ source_locale: "english!", translations: {} }, TARGETS, 0), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd supabase/functions && npx -y deno@2 test --config deno.json --no-lock _shared/translation_test.ts; cd ../..`
Expected: FAIL — module `./translation.ts` not found.

- [ ] **Step 3: Write the shared helper**

Create `supabase/functions/_shared/translation.ts`:

```ts
// Shared translation logic for translate-one, daily-translation, notify-comment
// and broadcast-post. One OpenAI structured-output call per item returns the
// detected source language and every target locale at once; rows are written
// with the service role. Pure parts (parseTranslationResponse,
// resolveTargetLocale, languageOf) are unit-tested in translation_test.ts.
//
// Secrets:
//   COMMUNITY_TRANSLATION_LOCALES  required when the module is on, e.g. "en,es-ES,es-419,it,pl,pt-PT,pt-BR"
//   COMMUNITY_TRANSLATION_MODEL    optional, default below
//   COMMUNITY_TRANSLATION_STYLE    optional per-app voice instruction
//   OPENAI_API_KEY                 shared with moderation

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const TARGET_LOCALES: string[] = (Deno.env.get("COMMUNITY_TRANSLATION_LOCALES") ?? "")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);
export const TRANSLATION_MODEL = Deno.env.get("COMMUNITY_TRANSLATION_MODEL") ?? "gpt-5-mini";
export const TRANSLATION_STYLE = Deno.env.get("COMMUNITY_TRANSLATION_STYLE") ?? "";
export const ENGINE = `openai:${TRANSLATION_MODEL}`;

export type TranslationRow = { locale: string; source_locale: string; content: string };
export type ParsedTranslation = {
  sourceLocale: string;
  translations: Record<string, { content: string; options: string[] }>;
};

export function languageOf(locale: string): string {
  return locale.split("-")[0].toLowerCase();
}

/** Exact target, else the first target of the same language, else null. */
export function resolveTargetLocale(
  profileLocale: string | null | undefined,
  targets: string[] = TARGET_LOCALES,
): string | null {
  if (!profileLocale) return null;
  if (targets.includes(profileLocale)) return profileLocale;
  const lang = languageOf(profileLocale);
  return targets.find((t) => languageOf(t) === lang) ?? null;
}

const SOURCE_LOCALE_RE = /^[a-z]{2,3}$/;

export function parseTranslationResponse(
  raw: unknown,
  targets: string[],
  optionCount: number,
): ParsedTranslation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { source_locale?: unknown; translations?: unknown };
  if (typeof r.source_locale !== "string") return null;
  const sourceLocale = r.source_locale.trim().toLowerCase();
  if (!SOURCE_LOCALE_RE.test(sourceLocale)) return null;
  if (!r.translations || typeof r.translations !== "object") return null;
  const out: ParsedTranslation["translations"] = {};
  for (const [locale, value] of Object.entries(r.translations as Record<string, unknown>)) {
    if (!targets.includes(locale)) continue;
    if (languageOf(locale) === sourceLocale) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as { content?: unknown; options?: unknown };
    if (typeof v.content !== "string" || v.content.trim().length === 0) continue;
    const options = Array.isArray(v.options) ? v.options : [];
    if (options.length !== optionCount || !options.every((o) => typeof o === "string")) continue;
    out[locale] = { content: v.content, options: options as string[] };
  }
  return { sourceLocale, translations: out };
}

/** One OpenAI call. Returns null on any failure (caller writes nothing). */
export async function translateItem(input: {
  content: string;
  options: string[];
  targets: string[];
}): Promise<ParsedTranslation | null> {
  const perLocale: Record<string, unknown> = {};
  for (const l of input.targets) {
    perLocale[l] = {
      type: "object",
      properties: {
        content: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["content", "options"],
      additionalProperties: false,
    };
  }
  const schema = {
    type: "object",
    properties: {
      source_locale: { type: "string", description: "ISO 639-1 language code of the ORIGINAL text" },
      translations: {
        type: "object",
        properties: perLocale,
        required: input.targets,
        additionalProperties: false,
      },
    },
    required: ["source_locale", "translations"],
    additionalProperties: false,
  };
  const instructions = [
    "You translate short social posts and comments from a mobile app community.",
    `Detect the language of the original text (ISO 639-1 code, e.g. en, es, pt) and return it as source_locale.`,
    `Translate the text into every target locale listed (${input.targets.join(", ")}). For a target whose language equals the source language, copy the original text unchanged.`,
    "Respect regional variants (es-ES vs es-419, pt-PT vs pt-BR). Keep emojis, line breaks, register and approximate length. Never add, summarise, moderate or explain.",
    input.options.length > 0
      ? `The text is a poll: also translate the ${input.options.length} option labels, in the same order and count, into "options". Return an empty options array when there are none.`
      : "Return an empty options array for every locale.",
    TRANSLATION_STYLE ? `App voice: ${TRANSLATION_STYLE}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        instructions,
        input: JSON.stringify({ text: input.content, options: input.options }),
        text: {
          format: { type: "json_schema", name: "translations", strict: true, schema },
        },
      }),
    });
    if (!res.ok) {
      console.error("translation api error", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    // Responses API: the JSON text lives in output[].content[].text; output_text is the convenience join.
    const text: string | undefined =
      data.output_text ??
      data.output?.flatMap((o: { content?: { text?: string }[] }) => o.content ?? []).find(
        (c: { text?: string }) => typeof c.text === "string",
      )?.text;
    if (!text) return null;
    return parseTranslationResponse(JSON.parse(text), input.targets, input.options.length);
  } catch (e) {
    console.error("translation failed", e);
    return null;
  }
}

/**
 * Translate `kind`/`id` into every missing target locale and upsert the rows.
 * Returns the rows now present for the item (possibly empty when the item is
 * in a target language), or null when translation failed (nothing written).
 * Idempotent: complete items make no API call.
 */
export async function ensureTranslations(
  supabase: SupabaseClient,
  kind: "post" | "comment",
  id: string,
): Promise<TranslationRow[] | null> {
  if (TARGET_LOCALES.length === 0) {
    console.log("community-sdk: COMMUNITY_TRANSLATION_LOCALES not set, skipping translation");
    return [];
  }
  const table = kind === "post" ? "posts" : "comments";
  const tTable = kind === "post" ? "post_translations" : "comment_translations";
  const fk = kind === "post" ? "post_id" : "comment_id";

  const { data: row } = await supabase.from(table).select("id, content, status").eq("id", id).single();
  if (!row || row.status !== "visible") return [];

  const { data: existing } = await supabase
    .from(tTable)
    .select("locale, source_locale, content")
    .eq(fk, id);
  const have = (existing ?? []) as TranslationRow[];
  const knownSource = have[0]?.source_locale;
  const missing = TARGET_LOCALES.filter(
    (l) => !have.some((h) => h.locale === l) && (!knownSource || languageOf(l) !== knownSource),
  );
  if (missing.length === 0) return have;

  let options: { id: string; idx: number; label: string }[] = [];
  if (kind === "post") {
    const { data, error } = await supabase
      .from("poll_options")
      .select("id, idx, label")
      .eq("post_id", id)
      .order("idx");
    if (!error && data) options = data as typeof options;
  }

  const parsed = await translateItem({
    content: row.content,
    options: options.map((o) => o.label),
    targets: missing,
  });
  if (!parsed) return null;

  const rows = Object.entries(parsed.translations).map(([locale, t]) => ({
    [fk]: id,
    locale,
    source_locale: parsed.sourceLocale,
    content: t.content,
    engine: ENGINE,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from(tTable).upsert(rows, { onConflict: `${fk},locale` });
    if (error) {
      console.error("translation upsert failed", error.message);
      return null;
    }
  }
  if (kind === "post" && options.length > 0) {
    const optionRows = Object.entries(parsed.translations).flatMap(([locale, t]) =>
      t.options.map((content, i) => ({ option_id: options[i].id, locale, content })),
    );
    if (optionRows.length > 0) {
      const { error } = await supabase
        .from("poll_option_translations")
        .upsert(optionRows, { onConflict: "option_id,locale" });
      if (error) console.error("poll option translation upsert failed", error.message);
    }
  }
  return [
    ...have,
    ...rows.map((r) => ({ locale: r.locale, source_locale: r.source_locale, content: r.content })),
  ];
}
```

- [ ] **Step 4: Run the tests and type-check**

Run: `cd supabase/functions && npx -y deno@2 test --config deno.json --no-lock _shared/translation_test.ts && npx -y deno@2 check --config deno.json --no-lock _shared/translation.ts; cd ../..`
Expected: 4 tests pass, check clean.

- [ ] **Step 5: Add the Deno step to CI**

In `.github/workflows/ci.yml`, after the prettier step add:

```yaml
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - run: cd supabase/functions && deno test --config deno.json --no-lock _shared/
      - run: cd supabase/functions && deno check --config deno.json --no-lock */index.ts
```

Also add `supabase/functions/deno.json` to `.prettierignore` is NOT needed (JSON is formatted by prettier; run `npx prettier --write supabase/functions/deno.json`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/translation.ts supabase/functions/_shared/translation_test.ts supabase/functions/deno.json .github/workflows/ci.yml
git commit -m "feat(backend): shared translation helper (OpenAI structured output, parser, ensureTranslations) + deno CI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `translate-one` and `daily-translation` functions

**Files:**
- Create: `supabase/functions/translate-one/index.ts`, `supabase/functions/daily-translation/index.ts`

**Interfaces:**
- Consumes: `ensureTranslations`, `TARGET_LOCALES` from Task 2; `items_missing_translations(kind, target_locales, max_items)` from Task 1; `adminClient`, `json` from `_shared/client.ts`; `postToSlack` from `_shared/slack.ts`.
- Produces: HTTP `POST /translate-one` body `{ kind, id }` → `{ status: "ok" | "skipped" | "failed" }`; `POST /daily-translation` → `{ posts, comments, failed }`.

- [ ] **Step 1: Write `translate-one`**

```ts
// Translate one published post or comment into every target locale. Called by
// the pg_net triggers in translation/001 (anon key, untrusted body: only
// `kind` and `id` are read, the row is re-read). Idempotent: an item that
// already has every translation costs no API call.

import { adminClient, json } from "../_shared/client.ts";
import { ensureTranslations } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown };
  const kind = body.kind === "post" || body.kind === "comment" ? body.kind : null;
  if (!kind || typeof body.id !== "string") return json({ status: "error", error: "bad request" }, 400);

  const rows = await ensureTranslations(supabase, kind, body.id);
  if (rows === null) return json({ status: "failed" }, 502);
  return json({ status: rows.length === 0 ? "skipped" : "ok", locales: rows.map((r) => r.locale) });
});
```

- [ ] **Step 2: Write `daily-translation`**

```ts
// Daily translation sweep: back-fills the history after installation and
// catches every item translate-one missed (API outage, secret set later, a
// locale added to COMMUNITY_TRANSLATION_LOCALES). Capped per run to fit the
// function's time budget; quiet unless something failed.

import { adminClient, json } from "../_shared/client.ts";
import { ensureTranslations, TARGET_LOCALES } from "../_shared/translation.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();
const MAX_ITEMS_PER_KIND = 250;

async function sweep(kind: "post" | "comment"): Promise<{ done: number; failed: number }> {
  const { data, error } = await supabase.rpc("items_missing_translations", {
    kind,
    target_locales: TARGET_LOCALES,
    max_items: MAX_ITEMS_PER_KIND,
  });
  if (error) {
    console.error("items_missing_translations failed", error.message);
    return { done: 0, failed: 1 };
  }
  let done = 0;
  let failed = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    const result = await ensureTranslations(supabase, kind, row.id);
    if (result === null) failed++;
    else done++;
  }
  return { done, failed };
}

Deno.serve(async () => {
  if (TARGET_LOCALES.length === 0) {
    return json({ posts: 0, comments: 0, failed: 0, note: "COMMUNITY_TRANSLATION_LOCALES not set" });
  }
  const posts = await sweep("post");
  const comments = await sweep("comment");
  const failed = posts.failed + comments.failed;
  if (failed > 0) {
    await postToSlack({
      text: `Daily translation: WARNING, ${failed} item(s) failed to translate (${posts.done} posts and ${comments.done} comments done); they will be retried tomorrow.`,
    });
  }
  return json({ posts: posts.done, comments: comments.done, failed });
});
```

- [ ] **Step 3: Type-check**

Run: `cd supabase/functions && npx -y deno@2 check --config deno.json --no-lock translate-one/index.ts daily-translation/index.ts; cd ../..`
Expected: clean.

- [ ] **Step 4: Verify the CLI packages them**

Run: `npm run build -w @rocapine/community && ls packages/cli/templates/functions | grep -E "translate-one|daily-translation"`
Expected: both directories listed (the `prebuild` copy picks them up automatically).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/translate-one supabase/functions/daily-translation
git commit -m "feat(backend): translate-one trigger function and daily-translation sweep

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Localized excerpts in `notify-comment` and `broadcast-post`

**Files:**
- Modify: `supabase/functions/notify-comment/index.ts`, `supabase/functions/broadcast-post/index.ts`

**Interfaces:**
- Consumes: `ensureTranslations`, `resolveTargetLocale`, `languageOf` (Task 2).

- [ ] **Step 1: `notify-comment` — translated excerpt for the recipient**

Add the import:

```ts
import { ensureTranslations, resolveTargetLocale, languageOf } from "../_shared/translation.ts";
```

Replace the excerpt block (currently `const excerpt = comment.content.length > 140 ? … : comment.content;`) with:

```ts
  // Recipient-language excerpt when the translation module is on: translate
  // now (a few seconds) rather than push the source language; on failure the
  // original goes out and the sweep fills the rows later.
  let excerptSource = comment.content;
  const targetLocale = resolveTargetLocale(recipient?.locale);
  if (targetLocale) {
    const rows = await ensureTranslations(supabase, "comment", comment.id);
    const match = rows?.find((r) => r.locale === targetLocale && languageOf(r.locale) !== r.source_locale);
    if (match) excerptSource = match.content;
  }
  const excerpt = excerptSource.length > 140 ? `${excerptSource.slice(0, 137)}...` : excerptSource;
```

(`recipient` is already fetched above for the push copy; keep that query and reuse it.)

- [ ] **Step 2: `broadcast-post` — one batch per recipient locale**

Add the same import. Replace everything from `const excerpt = …` to the `sendExpoPushBatch(...)` call with:

```ts
  const original = post.content.length > 140 ? `${post.content.slice(0, 137)}...` : post.content;
  const translations = (await ensureTranslations(supabase, "post", post.id)) ?? [];
  const excerptFor = (locale: string | null): string => {
    if (!locale) return original;
    const t = translations.find((r) => r.locale === locale);
    return t ? (t.content.length > 140 ? `${t.content.slice(0, 137)}...` : t.content) : original;
  };

  const { data: rows } = await supabase
    .from("push_tokens")
    .select("expo_push_token, profiles!push_tokens_user_id_fkey(locale)")
    .not("expo_push_token", "is", null);
  const messages = (rows ?? [])
    .map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { to: r.expo_push_token as string, locale: resolveTargetLocale(profile?.locale ?? null) };
    })
    .filter((m) => Boolean(m.to))
    .map(({ to, locale }) => ({
      to,
      title,
      body: excerptFor(locale),
      data: { route: "/community", kind: "community_official_post" },
      badge: 1,
    }));
  await sendExpoPushBatch(messages);
  const tokens = messages;
```

Check the FK name with `grep -n "references public.profiles" supabase/migrations/push/001_push.sql`: if `push_tokens.user_id` references `auth.users` rather than `profiles`, replace the embed with a second query `supabase.from("profiles").select("id, locale").in("id", userIds)` and a `Map<userId, locale>`; the join must not be guessed.

- [ ] **Step 3: Type-check and commit**

Run: `cd supabase/functions && npx -y deno@2 check --config deno.json --no-lock notify-comment/index.ts broadcast-post/index.ts; cd ../..`
Expected: clean (fix the `tokens.length` reference in the final `Response` of broadcast-post to `messages.length`).

```bash
git add supabase/functions/notify-comment supabase/functions/broadcast-post
git commit -m "feat(backend): comment pushes and official broadcasts in the recipient's language

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Core config and reader-locale resolver

**Files:**
- Modify: `packages/core/src/config.ts:5-10` (CommunityModules), `packages/core/src/index.ts`
- Create: `packages/core/src/locale.ts`
- Test: `packages/core/src/__tests__/locale.test.ts`

**Interfaces:**
- Produces: `CommunityModules.translation?: { locales: string[] } | false`; `readerLocale(cfg: ResolvedCommunityConfig): string | null`; `languageOf(locale: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { languageOf, readerLocale } from "../locale";

const base = {
  supabase: null,
  appName: "t",
  anonymousAuthorFallback: "Someone",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

describe("readerLocale", () => {
  const locales = ["en", "es-ES", "es-419", "pt-PT", "pl"];
  const cfgFor = (locale: string, translation: { locales: string[] } | false = { locales }) =>
    resolveConfig({ ...base, modules: { ...base.modules, translation }, host: { getLocale: () => locale } });

  it("returns null when the module is off", () => {
    expect(readerLocale(cfgFor("es-419", false))).toBeNull();
    expect(readerLocale(resolveConfig({ ...base, host: { getLocale: () => "en" } }))).toBeNull();
  });
  it("matches exactly, then by language, else null", () => {
    expect(readerLocale(cfgFor("es-419"))).toBe("es-419");
    expect(readerLocale(cfgFor("es-MX"))).toBe("es-ES");
    expect(readerLocale(cfgFor("pt-BR"))).toBe("pt-PT");
    expect(readerLocale(cfgFor("fr"))).toBeNull();
  });
  it("languageOf strips the region", () => {
    expect(languageOf("pt-BR")).toBe("pt");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @rocapine/community-core 2>&1 | grep -E "×|locale"`
Expected: FAIL — cannot find module `../locale`.

- [ ] **Step 3: Implement**

In `config.ts`, extend the type:

```ts
export type CommunityModules = {
  polls: boolean;
  push: boolean;
  inbox: boolean;
  reaction: { key: string } | false;
  /** Translation module: posts/comments/poll labels translated at publication
   * into these locales (must equal the backend's COMMUNITY_TRANSLATION_LOCALES
   * secret). Absent or false ⇒ every query and screen behaves as before. */
  translation?: { locales: string[] } | false;
};
```

Create `locale.ts`:

```ts
import type { ResolvedCommunityConfig } from "./config";

export function languageOf(locale: string): string {
  return locale.split("-")[0]?.toLowerCase() ?? "";
}

/**
 * The locale translations are read in: the host's locale resolved against
 * `modules.translation.locales` — exact match, else the first declared locale
 * of the same language, else null (originals only). Null when the module is off.
 */
export function readerLocale(cfg: ResolvedCommunityConfig): string | null {
  const module = cfg.modules.translation;
  if (!module || module.locales.length === 0) return null;
  const host = cfg.host.getLocale();
  if (module.locales.includes(host)) return host;
  const lang = languageOf(host);
  return module.locales.find((l) => languageOf(l) === lang) ?? null;
}
```

Export from `index.ts`: `export { readerLocale, languageOf } from "./locale";`

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npm run build -w @rocapine/community-core && npm test -w @rocapine/community-core 2>&1 | grep -E "Tests |×"`
Expected: all pass.

```bash
git add packages/core/src/config.ts packages/core/src/locale.ts packages/core/src/index.ts packages/core/src/__tests__/locale.test.ts
git commit -m "feat(core): translation module config and reader-locale resolver

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Core models — translation fields and mapping

**Files:**
- Modify: `packages/core/src/models.ts` (rows: `PostRow`, `PollOptionRow`, `CommentRow`; models: `FeedPost`, `ThreadComment`, `PollOption`; `buildPoll`, `mapPostRow`, `mapCommentRow`), `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/models.test.ts`

**Interfaces:**
- Produces: `TranslationInfo = { text: string; sourceLocale: string }`; `FeedPost.translation: TranslationInfo | null`; `ThreadComment.translation: TranslationInfo | null`; `PollOption.translatedLabel: string | null`; row fields `PostRow.post_translations?: TranslationRowEmbed[]`, `CommentRow.comment_translations?: TranslationRowEmbed[]`, `PollOptionRow.poll_option_translations?: { content: string }[]` with `TranslationRowEmbed = { locale: string; source_locale: string; content: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `models.test.ts` (reuse the file's existing row fixtures; if it has a `basePostRow` helper use it, otherwise build a minimal `PostRow` literal like the existing tests do):

```ts
describe("translations", () => {
  it("mapPostRow exposes the embedded translation and keeps text as the original", () => {
    const row = {
      ...basePostRow(),
      content: "Hello",
      post_translations: [{ locale: "es-419", source_locale: "en", content: "Hola" }],
    };
    const post = mapPostRow(row, "me", "Someone", [], new Set());
    expect(post.text).toBe("Hello");
    expect(post.translation).toEqual({ text: "Hola", sourceLocale: "en" });
  });
  it("mapPostRow yields translation null without an embed", () => {
    const post = mapPostRow(basePostRow(), "me", "Someone", [], new Set());
    expect(post.translation).toBeNull();
  });
  it("buildPoll carries translated labels when embedded", () => {
    const poll = buildPoll(
      [
        { id: "a", idx: 0, label: "Yes", poll_option_translations: [{ content: "Sí" }] },
        { id: "b", idx: 1, label: "No" },
      ],
      new Map(),
      null,
    );
    expect(poll?.options.map((o) => o.translatedLabel)).toEqual(["Sí", null]);
  });
  it("mapCommentRow exposes the embedded translation", () => {
    const comment = mapCommentRow(
      { ...baseCommentRow(), content: "Thanks", comment_translations: [{ locale: "pl", source_locale: "en", content: "Dzięki" }] },
      "me",
      "Someone",
    );
    expect(comment.text).toBe("Thanks");
    expect(comment.translation).toEqual({ text: "Dzięki", sourceLocale: "en" });
  });
});
```

If `basePostRow` / `baseCommentRow` helpers do not exist in the test file, add them at the top using the minimal valid row shapes from `PostRow` / `CommentRow` (all required fields, `poll_options: []`, `likes: [{count: 0}]`, `comments: [{count: 0}]`, `profiles: null`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @rocapine/community-core 2>&1 | grep -E "×"`
Expected: type errors / failures on `translation` / `translatedLabel`.

- [ ] **Step 3: Implement**

In `models.ts`:

```ts
/** One embedded translation row, filtered server-side on the reader locale. */
export interface TranslationRowEmbed {
  locale: string;
  source_locale: string;
  content: string;
}
export interface TranslationInfo {
  text: string;
  /** Detected language of the original (short code: en, es, pt…). */
  sourceLocale: string;
}
```

Add to `PostRow`: `post_translations?: TranslationRowEmbed[];`  
Add to `PollOptionRow`: `poll_option_translations?: { content: string }[];`  
Add to `CommentRow`: `comment_translations?: TranslationRowEmbed[];`  
Add to `PollOption`: `/** Label in the reader locale when the translation module provided one. */ translatedLabel: string | null;`  
Add to `FeedPost` and `ThreadComment`: `/** Reader-locale translation; null when the item is already in the reader's language, not translated yet, or the module is off. `text` stays the original. */ translation: TranslationInfo | null;`

Helper + mapping:

```ts
function embedToTranslation(rows: TranslationRowEmbed[] | undefined): TranslationInfo | null {
  const row = rows?.[0];
  return row ? { text: row.content, sourceLocale: row.source_locale } : null;
}
```

In `buildPoll`'s `.map`: `({ id: o.id, label: o.label, translatedLabel: o.poll_option_translations?.[0]?.content ?? null, votes: counts.get(o.id) ?? 0 })`.  
In `mapPostRow`: `translation: embedToTranslation(row.post_translations),`.  
In `mapCommentRow`: `translation: embedToTranslation(row.comment_translations),`.  
Check `applyPollVote` / any place constructing `PollOption` or `FeedPost` literals in core (`grep -n "votes:" packages/core/src/*.ts`, the optimistic post in `hooks.ts` `useCreatePost`) and add `translatedLabel: null` / `translation: null` there.

Export the two new types from `index.ts` (`TranslationInfo`, `TranslationRowEmbed`).

- [ ] **Step 4: Run tests, build, commit**

Run: `npm run build && npm run typecheck && npm test 2>&1 | grep -E "Tests |×"`
Expected: all pass (ui compiles against the new core types because the fields are additive).

```bash
git add packages/core
git commit -m "feat(core): translation fields on FeedPost, ThreadComment and PollOption

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Core selects and query keys

**Files:**
- Modify: `packages/core/src/service.ts` (`buildFeedSelect`, `postsSelect`, `fetchFeedPage`, `fetchUserPosts`, `searchPosts`, `fetchThread`), `packages/core/src/hooks.ts` (key helpers and every call site)
- Test: `packages/core/src/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `readerLocale(cfg)` (Task 5).
- Produces: `buildFeedSelect(extraPostColumns?: readonly string[], polls = false, translations = false): string`; `applyTranslationFilters(query, locale, polls)` internal.

- [ ] **Step 1: Write the failing tests**

Append to `service.test.ts`:

```ts
it("embeds translations (and nested poll label translations) only when asked", () => {
  const plain = buildFeedSelect(undefined, true, false);
  expect(plain).not.toContain("post_translations");
  const withT = buildFeedSelect(undefined, true, true);
  expect(withT).toContain("post_translations(locale, source_locale, content)");
  expect(withT).toContain("poll_options(id, idx, label, poll_option_translations(content))");
  const noPolls = buildFeedSelect(undefined, false, true);
  expect(noPolls).toContain("post_translations(");
  expect(noPolls).not.toContain("poll_option");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @rocapine/community-core 2>&1 | grep -E "×"`

- [ ] **Step 3: Implement the selects**

In `service.ts`:

```ts
const POLL_OPTIONS_SELECT = "poll_options(id, idx, label)";
const POLL_OPTIONS_TRANSLATED_SELECT = "poll_options(id, idx, label, poll_option_translations(content))";
const POST_TRANSLATIONS_SELECT = "post_translations(locale, source_locale, content)";

export function buildFeedSelect(
  extraPostColumns?: readonly string[],
  polls = false,
  translations = false,
): string {
  const parts = [FEED_SELECT];
  if (polls) parts.push(translations ? POLL_OPTIONS_TRANSLATED_SELECT : POLL_OPTIONS_SELECT);
  if (translations) parts.push(POST_TRANSLATIONS_SELECT);
  const base = parts.join(", ");
  // …existing extraPostColumns handling unchanged, using `base`
}

function postsSelect(cfg: ResolvedCommunityConfig): string {
  return buildFeedSelect(cfg.feed.extraPostColumns, cfg.modules.polls, readerLocale(cfg) !== null);
}

/** Embedded-resource filters: keep only the reader locale's rows. PostgREST
 * accepts dotted paths for nested embeds. */
function withTranslationFilters<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  cfg: ResolvedCommunityConfig,
): Q {
  const locale = readerLocale(cfg);
  if (!locale) return query;
  let q = query.eq("post_translations.locale", locale);
  if (cfg.modules.polls) q = q.eq("poll_options.poll_option_translations.locale", locale);
  return q;
}
```

Apply `withTranslationFilters(query, cfg)` to the three posts queries (`fetchFeedPage` — before the topic filter, note `let query`; `fetchUserPosts`; `searchPosts`). In `fetchThread`, when `readerLocale(cfg)` is non-null, extend the select with `, comment_translations(locale, source_locale, content)` and add `.eq("comment_translations.locale", locale)`.

- [ ] **Step 4: Put the reader locale in the query keys**

In `hooks.ts`:

```ts
const feedKey = (topic?: string, locale?: string | null) => [...FEED_KEY, topic ?? "all", locale ?? "src"] as const;
const threadKey = (postId: string, locale?: string | null) => ["community", "thread", postId, locale ?? "src"] as const;
const userPostsKey = (userId: string, locale?: string | null) => [...USER_POSTS_KEY, userId, locale ?? "src"] as const;
```

Then `grep -n "feedKey(\|threadKey(\|userPostsKey(\|SEARCH_KEY, cleaned" packages/core/src/hooks.ts` and pass `readerLocale(cfg)` at every call site (each hook already has `cfg`; add `const locale = readerLocale(cfg);` where needed). The search key becomes `[...SEARCH_KEY, cleaned, locale ?? "src"]`. `bumpFeedCommentCount`, `applyOptimisticToAllPostCaches` and `useDeleteContent` use prefix keys (`FEED_KEY`, `USER_POSTS_KEY`, `SEARCH_KEY`, `threadKey(postId, locale)`) — verify each still targets the right cache. `postCache.ts` in the ui package matches on `["community","thread", …]` prefixes: check `findCachedPost` / `subscribeToPostListCaches` still work with the extra key segment (they filter on key[1]; run the ui tests).

- [ ] **Step 5: Run everything, commit**

Run: `npm run build && npm run typecheck && npm test 2>&1 | grep -E "Tests |×"`
Expected: all pass.

```bash
git add packages/core/src/service.ts packages/core/src/hooks.ts packages/core/src/__tests__/service.test.ts
git commit -m "feat(core): embed reader-locale translations in feed/thread selects; locale in query keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Core inbox excerpts and the toggle event

**Files:**
- Modify: `packages/core/src/inbox-service.ts:78-90` (`fetchInbox`), `packages/core/src/events.ts`
- Test: `packages/core/src/__tests__/inbox-service.test.ts`, `packages/core/src/__tests__/events.test.ts`

**Interfaces:**
- Produces: `COMMUNITY_EVENTS.translationToggled = "community_translation_toggled"`; `localizeExcerpts(items: InboxItem[], translations: { post_id: string; content: string }[]): InboxItem[]` (pure, exported for tests).

- [ ] **Step 1: Write the failing tests**

In `inbox-service.test.ts`:

```ts
it("localizeExcerpts swaps postExcerpt for the translated 140-char excerpt", () => {
  const items = [
    { id: "n1", kind: "like", createdAt: "2026-01-01T00:00:00Z", actorName: null, postId: "p1", payload: { postExcerpt: "Hello" } },
    { id: "n2", kind: "like", createdAt: "2026-01-01T00:00:00Z", actorName: null, postId: "p2", payload: { postExcerpt: "Keep" } },
  ] as InboxItem[];
  const out = localizeExcerpts(items, [{ post_id: "p1", content: "x".repeat(200) }]);
  expect(out[0].payload.postExcerpt).toBe("x".repeat(140));
  expect(out[1].payload.postExcerpt).toBe("Keep");
});
```

In `events.test.ts`: `expect(COMMUNITY_EVENTS.translationToggled).toBe("community_translation_toggled");`

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @rocapine/community-core 2>&1 | grep -E "×"`

- [ ] **Step 3: Implement**

`events.ts`: add `translationToggled: "community_translation_toggled",` to `COMMUNITY_EVENTS`.

`inbox-service.ts`:

```ts
import { readerLocale } from "./locale";

/** Same truncation as list_notifications()'s `left(p.content, 140)`. */
export function localizeExcerpts(
  items: InboxItem[],
  translations: { post_id: string; content: string }[],
): InboxItem[] {
  if (translations.length === 0) return items;
  const byPost = new Map(translations.map((t) => [t.post_id, t.content.slice(0, 140)]));
  return items.map((item) => {
    const translated = item.postId ? byPost.get(item.postId) : undefined;
    return translated === undefined ? item : { ...item, payload: { ...item.payload, postExcerpt: translated } };
  });
}
```

In `fetchInbox`, after `const items = …`:

```ts
  const locale = readerLocale(cfg);
  const postIds = [...new Set(items.map((i) => i.postId).filter((id): id is string => Boolean(id)))];
  let localized = items;
  if (locale && postIds.length > 0) {
    const { data } = await client
      .from("post_translations")
      .select("post_id, content")
      .eq("locale", locale)
      .in("post_id", postIds);
    localized = localizeExcerpts(items, (data ?? []) as { post_id: string; content: string }[]);
  }
  return { items: localized, seenAt: … };
```

Export `localizeExcerpts` from `index.ts`.

- [ ] **Step 4: Run tests, commit**

Run: `npm run build && npm test 2>&1 | grep -E "Tests |×"`

```bash
git add packages/core
git commit -m "feat(core): inbox excerpts in the reader locale; community_translation_toggled event

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: UI helper and locale catalogues

**Files:**
- Create: `packages/ui/src/utils/translation.ts`, `packages/ui/src/__tests__/translation.test.ts`
- Modify: `packages/ui/src/locales/{en,fr,de,es-ES,es-419,it,pl,pt-PT,pt-BR}.ts`, `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `displayText(item: Translatable, showOriginal: boolean): string`; `translationLine(t: TFn, item: Translatable, showOriginal: boolean): string | null`; `type Translatable = { text: string; translation: { text: string; sourceLocale: string } | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { displayText, translationLine } from "../utils/translation";

const item = { text: "Hello", translation: { text: "Hola", sourceLocale: "en" } };

describe("translation helpers", () => {
  it("shows the translation by default and the original when toggled", () => {
    expect(displayText(item, false)).toBe("Hola");
    expect(displayText(item, true)).toBe("Hello");
    expect(displayText({ text: "Hi", translation: null }, false)).toBe("Hi");
  });
  it("builds the toggle line with the source language name", () => {
    const t = makeT("es-ES");
    expect(translationLine(t, item, false)).toBe("Traducido del inglés · Ver original");
    expect(translationLine(t, item, true)).toBe("Original · Ver traducción");
    expect(translationLine(t, { text: "x", translation: null }, false)).toBeNull();
  });
  it("falls back to the raw code for an unknown language", () => {
    const t = makeT("en");
    expect(translationLine(t, { text: "x", translation: { text: "y", sourceLocale: "xx" } }, false)).toBe(
      "Translated from xx · See original",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @rocapine/community-ui 2>&1 | grep -E "×"`

- [ ] **Step 3: Implement the helper**

```ts
// Pure display logic for translated items (CommunityPost, CommentRow), kept
// out of the components so it is unit-testable without React Native.
import type { TFn } from "../i18n";

export type Translatable = { text: string; translation: { text: string; sourceLocale: string } | null };

export function displayText(item: Translatable, showOriginal: boolean): string {
  return item.translation && !showOriginal ? item.translation.text : item.text;
}

/** "Translated from English · See original" / "Original · See translation"; null when untranslated. */
export function translationLine(t: TFn, item: Translatable, showOriginal: boolean): string | null {
  if (!item.translation) return null;
  if (showOriginal) return `${t("translation.original")} · ${t("translation.showTranslation")}`;
  const key = `language.${item.translation.sourceLocale}`;
  const named = t(key);
  const language = named === key ? item.translation.sourceLocale : named;
  return `${t("translation.translatedFrom", { language })} · ${t("translation.showOriginal")}`;
}
```

Export from `index.ts`: `export { displayText, translationLine } from "./utils/translation"; export type { Translatable } from "./utils/translation";`

- [ ] **Step 4: Add the catalogue keys to all nine locales**

Append to each `locales/*.ts` (keep the key-set parity test green — every file gets the same keys):

en:
```ts
  "translation.translatedFrom": "Translated from {language}",
  "translation.original": "Original",
  "translation.showOriginal": "See original",
  "translation.showTranslation": "See translation",
  "language.en": "English", "language.es": "Spanish", "language.pt": "Portuguese",
  "language.it": "Italian", "language.pl": "Polish", "language.fr": "French", "language.de": "German",
```
fr: `"Traduit du {language}"`, `"Original"`, `"Voir l'original"`, `"Voir la traduction"`, languages `anglais, espagnol, portugais, italien, polonais, français, allemand` (lower-case; the sentence reads "Traduit de l'anglais" — use `"translation.translatedFrom": "Traduit de {language}"` with language values `l'anglais, l'espagnol, du portugais…`? No: keep one template and article-free names: `"Traduit depuis : {language}"` avoids gender/elision issues). Use `"Traduit depuis : {language}"` with `anglais, espagnol, portugais, italien, polonais, français, allemand`.  
de: `"Übersetzt aus dem {language}"` with `Englischen, Spanischen, Portugiesischen, Italienischen, Polnischen, Französischen, Deutschen`; `"Original"`, `"Original anzeigen"`, `"Übersetzung anzeigen"`.  
es-ES / es-419: `"Traducido del {language}"` with `inglés, español, portugués, italiano, polaco, francés, alemán`; `"Original"`, `"Ver original"`, `"Ver traducción"`.  
it: `"Tradotto da: {language}"` with `inglese, spagnolo, portoghese, italiano, polacco, francese, tedesco`; `"Originale"`, `"Vedi originale"`, `"Vedi traduzione"`.  
pl: `"Przetłumaczono z języka: {language}"` with `angielski, hiszpański, portugalski, włoski, polski, francuski, niemiecki`; `"Oryginał"`, `"Zobacz oryginał"`, `"Zobacz tłumaczenie"`.  
pt-PT: `"Traduzido do {language}"` with `inglês, espanhol, português, italiano, polaco, francês, alemão`; `"Original"`, `"Ver original"`, `"Ver tradução"`.  
pt-BR: same as pt-PT but `polonês`.

The es-ES test above expects exactly `Traducido del inglés · Ver original`.

- [ ] **Step 5: Run tests, commit**

Run: `npm run build -w @rocapine/community-ui && npm test -w @rocapine/community-ui 2>&1 | grep -E "Tests |×"`
Expected: pass, including the catalogue key-parity tests.

```bash
git add packages/ui
git commit -m "feat(ui): translation display helpers and catalogue keys in 9 locales

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: UI wiring — post card, poll block, comment row

**Files:**
- Modify: `packages/ui/src/components/CommunityPost.tsx:195-225` (body + new line), `packages/ui/src/components/PollBlock.tsx:20-60`, `packages/ui/src/screens/ThreadSheet.tsx` (CommentRow)

**Interfaces:**
- Consumes: `displayText`, `translationLine` (Task 9); `COMMUNITY_EVENTS.translationToggled`, `emitEvent`, `useCommunityConfig` (core).
- Produces: `PollBlock` prop `showOriginal?: boolean` (default false).

- [ ] **Step 1: CommunityPost**

Add imports (`useCommunityConfig`, `COMMUNITY_EVENTS`, `emitEvent` from core if not already imported; `displayText`, `translationLine` from `../utils/translation`). Inside the component:

```tsx
  const cfg = useCommunityConfig();
  const [showOriginal, setShowOriginal] = useState(false);
  const toggleLine = translationLine(t, post, showOriginal);
  const toggleOriginal = () => {
    setShowOriginal((v) => {
      emitEvent(cfg, COMMUNITY_EVENTS.translationToggled, {
        postId: post.id,
        to: v ? "translation" : "original",
      });
      return !v;
    });
  };
```

Replace `{post.text}` with `{displayText(post, showOriginal)}`. After the `overflows` block and before `{post.poll && <PollBlock post={post} />}` add:

```tsx
      {toggleLine && (
        <Pressable hitSlop={8} onPress={toggleOriginal}>
          <Text style={styles.translationLine}>{toggleLine}</Text>
        </Pressable>
      )}
```

Pass `showOriginal` to `PollBlock`: `<PollBlock post={post} showOriginal={showOriginal} />`. Add the style:

```ts
    translationLine: {
      fontFamily: theme.fonts.medium,
      fontSize: 12.5,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(1.5),
    },
```

Reset `fullLines` when the displayed text changes so the clamp is recomputed: add `useEffect(() => { setFullLines(null); }, [showOriginal]);` next to the existing clamp state (import `useEffect` if missing).

- [ ] **Step 2: PollBlock**

Signature: `export function PollBlock({ post, showOriginal = false }: { post: FeedPost; showOriginal?: boolean })`. Replace `{option.label}` with `{showOriginal ? option.label : (option.translatedLabel ?? option.label)}`.

- [ ] **Step 3: CommentRow in ThreadSheet**

Same pattern as the post: `const cfg = useCommunityConfig();` (already imported in the file), `const [showOriginal, setShowOriginal] = useState(false);`, `const toggleLine = translationLine(t, comment, showOriginal);`, event props `{ commentId: comment.id, to }`, `{displayText(comment, showOriginal)}` in the body `Text`, the toggle `Pressable` after the view-more toggle with style `cTranslationLine` (same values as `translationLine`), and `useEffect(() => setFullLines(null), [showOriginal])`.

- [ ] **Step 4: Build, typecheck, tests, prettier, commit**

Run: `npm run build && npm run typecheck && npm test 2>&1 | grep -E "Tests |×" && npx prettier --check .`

```bash
git add packages/ui
git commit -m "feat(ui): show translations with a per-item see-original toggle on posts, comments and polls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs, changesets, README module matrix

**Files:**
- Modify: `README.md` (module matrix + config example), `docs/backend-runbook.md` (§3 secrets table + cron list), `docs/compat.md`, `packages/core/README.md` (config reference), `packages/ui/README.md` (screens/components notes)
- Create: `.changeset/translation-core.md`, `.changeset/translation-ui.md`, `.changeset/translation-cli.md`

- [ ] **Step 1: README module matrix**

Add a row:

```
| translation | `modules.translation: { locales: string[] } \| false` | posts, comments and poll labels translated at publication into the listed locales, shown in the reader's language with a per-item "see original"; comment pushes, official broadcasts and inbox excerpts in the recipient's language | `supabase/migrations/translation/*`, `translate-one`, `daily-translation` (+ `notify-comment`/`broadcast-post` use it) |
```

and `translation: { locales: ["en", "es-419"] }` in the quickstart `modules` example with a comment that the list must equal the `COMMUNITY_TRANSLATION_LOCALES` secret.

- [ ] **Step 2: Backend runbook**

Secrets table rows for `COMMUNITY_TRANSLATION_LOCALES` (required with the module; "must equal the client list"), `COMMUNITY_TRANSLATION_MODEL` (optional, default `gpt-5-mini`), `COMMUNITY_TRANSLATION_STYLE` (optional). Cron table row `community-translation-sweep | 30 8 * * * | translation | POSTs to daily-translation — back-fills and retries translations`. A short "Translation" subsection under §5 mirroring the username one: source detection by the model, no row for the source language, sweep cap 250 per kind per run, failures only in Slack.

- [ ] **Step 3: compat + package READMEs + changesets**

`docs/compat.md`: extend the `0.2.x` row note or add `| 0.3.x | 1 | Adds the optional additive translation module (3 tables, 2 functions). |`.  
`packages/core/README.md`: document `modules.translation`, `readerLocale`, the `translation` fields, and that `text` stays the original.  
`packages/ui/README.md`: note the toggle line, the `translation.*` / `language.*` keys, `PollBlock.showOriginal`.

Changesets:

`.changeset/translation-core.md` — `"@rocapine/community-core": minor` — "Translation module: `modules.translation`, `readerLocale`, reader-locale translation embeds in feed/thread selects (only when the module is on), `translation` fields on `FeedPost`/`ThreadComment` and `translatedLabel` on poll options (`text` stays the original), inbox excerpts in the reader locale, `community_translation_toggled` event."  
`.changeset/translation-ui.md` — `"@rocapine/community-ui": minor` — "Posts, comments and poll labels display their reader-locale translation with a per-item 'Translated from X · See original' toggle; `displayText`/`translationLine` helpers; `translation.*` and `language.*` catalogue keys in 9 locales."  
`.changeset/translation-cli.md` — `"@rocapine/community": minor` — "New `translation` module: `translation/001_translations.sql`, `translate-one`, `daily-translation`; `notify-comment` and `broadcast-post` send excerpts in the recipient's language; secrets `COMMUNITY_TRANSLATION_LOCALES` (required), `COMMUNITY_TRANSLATION_MODEL`, `COMMUNITY_TRANSLATION_STYLE`."

- [ ] **Step 4: Prettier, commit**

Run: `npx prettier --write . && npx prettier --check . && npm test 2>&1 | grep -E "Tests |×"`

```bash
git add README.md docs packages/core/README.md packages/ui/README.md .changeset
git commit -m "docs: translation module (module matrix, runbook secrets and cron, compat, package READMEs) + changesets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Install on the scratch project and verify end to end

**Files:** none in the repo (scratch project `cozfrhmbjrvotpwjnqmu`; Eve worktree for the app-side check is created at `/Users/glsx/Developer/eden-sdk-translation-qa` from Eve's `main`).

**Interfaces:** consumes everything above via the built CLI (`node packages/cli/lib/index.js` or `npm exec -w @rocapine/community -- community …`).

- [ ] **Step 1: Apply the module to scratch**

From a scratch checkout of Eve (`git -C ~/Developer/eden-s-rythm worktree add ~/Developer/eden-sdk-translation-qa main`), run the built CLI: `node /Users/glsx/Developer/community-sdk/packages/cli/lib/index.js upgrade --modules translation` (it copies `…_community_translation_translations.sql` and the two functions and re-syncs `notify-comment`/`broadcast-post`). Then, against scratch only:

```bash
supabase link --project-ref cozfrhmbjrvotpwjnqmu
supabase db push --dry-run   # expect exactly the translation migration
supabase db push
supabase secrets set --project-ref cozfrhmbjrvotpwjnqmu COMMUNITY_TRANSLATION_LOCALES="en,es-ES,es-419,it,pl,pt-PT,pt-BR"
supabase functions deploy translate-one daily-translation notify-comment broadcast-post --project-ref cozfrhmbjrvotpwjnqmu --use-api
```

- [ ] **Step 2: Run the sweep and inspect**

```bash
curl -s -X POST "https://cozfrhmbjrvotpwjnqmu.supabase.co/functions/v1/daily-translation" -H "Authorization: Bearer <scratch anon key>"
```

Expected JSON with `posts` and `comments` > 0 and `failed: 0`. Then (SQL editor or MCP `execute_sql` on scratch): `select post_id, locale, source_locale, left(content, 40) from post_translations order by created_at desc limit 20;` — rows for every target locale except the source; `select count(*) from poll_option_translations;` > 0 if scratch has a poll post.

- [ ] **Step 3: Trigger path**

Create a post from the Eve QA build (worktree `.env` pointed at scratch, see memory `community-sdk-dev-environment`), wait ~5 s, verify its rows appear without the sweep. Do the same with a comment.

- [ ] **Step 4: App-side check**

In the Eve QA worktree, `npm install ../community-sdk/packages/core ../community-sdk/packages/ui` (file links need the metro `watchFolders` + dedupe shims that were removed in 9f5b7ed — re-add them temporarily in the worktree only, or `npm pack` both packages and install the tarballs, which needs no shim). Enable `translation: { locales: [...] }` in `lib/community-config.ts` (same list as the secret). Switch the simulator app language to Spanish (es-419): feed shows Spanish text with "Traducido del inglés · Ver original", tapping toggles; a poll shows translated labels; thread comments translated; inbox excerpts translated; posting a comment from a second seeded account with a push token yields a Spanish push body. Revert the worktree, remove it (`git worktree remove --force`), remove the scratch `.env` edits.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/translation
gh pr create --title "feat: translation module (posts, comments, polls, pushes, inbox)" --body "Implements docs/superpowers/specs/2026-09-23-post-translation-design.md — see the plan in docs/superpowers/plans/2026-09-23-post-translation.md for the task list and the scratch verification steps.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

CI must be green (vitest, prettier, deno test/check). Release follows as 0.3.0 via `npx changeset version` + `npm run release` (human).
