import { assert } from "jsr:@std/assert@1";
import { postImageUrl } from "./images.ts";

Deno.test("postImageUrl points at the public post-images bucket", () => {
  assert(postImageUrl("u1/a.jpg").endsWith("/storage/v1/object/public/post-images/u1/a.jpg"));
});
