import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@1";
import { containsAppName, isReservedHandle, suggestHandle } from "./names.ts";

Deno.test("containsAppName matches the app name inside a display name, any case or accent", () => {
  assert(containsAppName("Unchaind Team", "Unchaind"));
  assert(containsAppName("l'équipe UNCHAIND", "Unchaind"));
  assert(containsAppName("Night Ward", "Nightward"));
  assertFalse(containsAppName("Paul", "Unchaind"));
  assertFalse(containsAppName("Paul", ""));
});

Deno.test("containsAppName only matches a short app name as a whole word", () => {
  assert(containsAppName("Team Eve", "Eve"));
  assertFalse(containsAppName("Steve", "Eve"));
});

Deno.test("isReservedHandle covers staff handles and the app name", () => {
  assert(isReservedHandle("admin", "Unchaind"));
  assert(isReservedHandle("unchaind-official", "Unchaind"));
  assertFalse(isReservedHandle("superuser", "Unchaind"));
});

Deno.test("suggestHandle returns a free handle on the same base", async () => {
  const taken = new Set<string>();
  let calls = 0;
  const suggestion = await suggestHandle("superuser", (c) => {
    calls++;
    // first candidate taken, second free
    if (calls === 1) {
      taken.add(c);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  });
  assertMatch(suggestion!, /^superuser-\d{4}$/);
  assertFalse(taken.has(suggestion!));
});

Deno.test("suggestHandle keeps the base within 15 chars and drops an existing suffix", async () => {
  const s = await suggestHandle("averyveryverylonghandle", () => Promise.resolve(true));
  assertEquals(s!.split("-")[0].length, 15);
  const t = await suggestHandle("brother-4821", () => Promise.resolve(true));
  assertMatch(t!, /^brother-\d{4}$/);
});
