import { assertEquals } from "jsr:@std/assert@1";
import { fetchAllRows } from "./client.ts";

type Page = { data: number[] | null; error: { message: string } | null };

/** A fake page source: serves `sizes[i]` rows on call i and records each range. */
function fakePages(sizes: (number | "error")[]) {
  const calls: [number, number][] = [];
  const page = (from: number, to: number): Promise<Page> => {
    const size = sizes[calls.length];
    calls.push([from, to]);
    if (size === "error") return Promise.resolve({ data: null, error: { message: "boom" } });
    return Promise.resolve({
      data: Array.from({ length: size ?? 0 }, (_, i) => from + i),
      error: null,
    });
  };
  return { page, calls };
}

Deno.test("fetchAllRows: reads pages until a short one", async () => {
  const { page, calls } = fakePages([1000, 1000, 3]);
  const rows = await fetchAllRows(page);
  assertEquals(rows.length, 2003);
  assertEquals(rows[2002], 2002);
  assertEquals(calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

Deno.test("fetchAllRows: an exact multiple stops on the empty page", async () => {
  const { page, calls } = fakePages([1000, 1000, 0]);
  assertEquals((await fetchAllRows(page)).length, 2000);
  assertEquals(calls.length, 3);
});

Deno.test("fetchAllRows: a failed page keeps the rows already read", async () => {
  const { page, calls } = fakePages([1000, "error", 1000]);
  const err = console.error;
  console.error = () => {};
  try {
    assertEquals((await fetchAllRows(page)).length, 1000);
  } finally {
    console.error = err;
  }
  assertEquals(calls.length, 2);
});

Deno.test("fetchAllRows: respects pageSize", async () => {
  const { page, calls } = fakePages([2, 2, 1]);
  assertEquals(await fetchAllRows(page, 2), [0, 1, 2, 3, 4]);
  assertEquals(calls, [
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
});
