// Shared Supabase client fakes for the messaging and groups service tests.
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { resolveConfig, type CommunityModules } from "../config";

/** Chainable PostgREST stand-in: every method records itself and returns the
 * builder, which resolves to `result` when awaited. */
export function fakeQuery(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const q: object = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then")
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej);
        if (prop === "calls") return calls;
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return q;
        };
      },
    },
  );
  return q as { calls: [string, unknown[]][] };
}

export function fakeClient(opts: {
  rpc?: (fn: string, args?: unknown) => { data: unknown; error: unknown };
  tables?: Record<string, { data: unknown; error: unknown }>;
}) {
  const order: string[] = [];
  const queries: Record<string, { calls: [string, unknown[]][] }[]> = {};
  const client = {
    order,
    queries,
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "uid1" } } } })),
      signInAnonymously: vi.fn(),
    },
    rpc: vi.fn(async (fn: string, args?: unknown) => {
      // ensureIdentity's own call on a first session.
      if (fn === "assign_default_profile") return { data: null, error: null };
      order.push(`rpc:${fn}`);
      return opts.rpc?.(fn, args) ?? { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const q = fakeQuery(opts.tables?.[table] ?? { data: [], error: null });
      (queries[table] ??= []).push(q);
      return q;
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(async (path: string) => {
          order.push(`upload:${bucket}:${path}`);
          return { data: { path }, error: null };
        }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${bucket}/${path}` } }),
        createSignedUrl: vi.fn(async (path: string) => ({
          data: { signedUrl: `https://signed/${bucket}/${path}` },
          error: null,
        })),
      })),
    },
    functions: {
      invoke: vi.fn(async (name: string, { body }: { body: unknown }) => {
        order.push(`fn:${name}:${JSON.stringify(body)}`);
        return { data: { status: "published" }, error: null };
      }),
    },
  };
  return client;
}

export function cfgWith(
  client: ReturnType<typeof fakeClient>,
  modules: Partial<CommunityModules> = {},
) {
  return resolveConfig({
    supabase: client as unknown as SupabaseClient,
    appName: "Test",
    topics: [{ id: "general" }],
    modules: { polls: false, push: false, inbox: false, reaction: false, groups: {}, ...modules },
    host: { getLocale: () => "fr" },
  });
}

/** The args of the first call to `fn`. */
export function rpcArgs(client: ReturnType<typeof fakeClient>, fn: string) {
  return client.rpc.mock.calls.find(([f]) => f === fn)?.[1] as Record<string, unknown> | undefined;
}
