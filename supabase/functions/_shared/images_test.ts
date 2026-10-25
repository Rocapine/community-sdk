import { assert, assertEquals } from "jsr:@std/assert@1";
import { fetchImagePath, fetchImagePaths, postImageUrl } from "./images.ts";

Deno.test("postImageUrl points at the public post-images bucket", () => {
  assert(postImageUrl("u1/a.jpg").endsWith("/storage/v1/object/public/post-images/u1/a.jpg"));
});

// Stub of the supabase-js query chain: every builder step returns itself and
// awaiting / .single() yields `result`. `calls` records each `.in()` id list.
function stub(result: (ids?: string[]) => unknown) {
  const calls: string[][] = [];
  let ids: string[] | undefined;
  // deno-lint-ignore no-explicit-any
  const q: any = {
    select: () => q,
    eq: () => q,
    not: () => q,
    in: (_c: string, v: string[]) => {
      calls.push(v);
      ids = v;
      return q;
    },
    single: () => Promise.resolve(result()),
    // deno-lint-ignore no-explicit-any
    then: (res: any) => res(result(ids)),
  };
  // deno-lint-ignore no-explicit-any
  return { client: { from: () => q } as any, calls };
}

const missingColumn = { error: { code: "42703", message: "column does not exist" }, data: null };
const transient = { error: { code: "", message: "fetch failed" }, data: null };

Deno.test("fetchImagePath: path, none, missing column => no image", async () => {
  assertEquals(
    await fetchImagePath(
      stub(() => ({ data: { image_path: "u/a.jpg" }, error: null })).client,
      "posts",
      "1",
    ),
    { ok: true, path: "u/a.jpg" },
  );
  assertEquals(
    await fetchImagePath(
      stub(() => ({ data: { image_path: null }, error: null })).client,
      "posts",
      "1",
    ),
    { ok: true, path: null },
  );
  assertEquals(await fetchImagePath(stub(() => missingColumn).client, "posts", "1"), {
    ok: true,
    path: null,
  });
});

Deno.test("fetchImagePath: any other error fails closed", async () => {
  assertEquals(await fetchImagePath(stub(() => transient).client, "posts", "1"), { ok: false });
});

Deno.test(
  "fetchImagePaths: chunks ids, reports failed chunks, stops on missing column",
  async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id${i}`);

    const ok = stub((v) => ({
      data: v!.map((id) => ({ id, image_path: `${id}.jpg` })),
      error: null,
    }));
    const r = await fetchImagePaths(ok.client, "posts", ids, 2);
    assertEquals(
      ok.calls.map((c) => c.length),
      [2, 2, 1],
    );
    assertEquals(r.paths.size, 5);
    assertEquals(r.failedIds.size, 0);

    const failing = stub((v) => (v!.includes("id2") ? transient : { data: [], error: null }));
    const f = await fetchImagePaths(failing.client, "posts", ids, 2);
    assertEquals([...f.failedIds].sort(), ["id2", "id3"]);

    const noModule = await fetchImagePaths(stub(() => missingColumn).client, "posts", ids, 2);
    assertEquals(noModule.paths.size + noModule.failedIds.size, 0);
  },
);
