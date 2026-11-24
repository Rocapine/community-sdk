import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { resetCommunityQueries } from "../hooks";

it("drops every community query after an account transition, and only those", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["community", "myUid"], "old-profile");
  queryClient.setQueryData(["community", "feed", "all", "src"], { pages: [[{ id: "p1" }]] });
  queryClient.setQueryData(["host", "settings"], { theme: "dark" });
  await resetCommunityQueries(queryClient);
  expect(queryClient.getQueryData(["community", "myUid"])).toBeUndefined();
  expect(queryClient.getQueryData(["community", "feed", "all", "src"])).toBeUndefined();
  expect(queryClient.getQueryData(["host", "settings"])).toEqual({ theme: "dark" });
});
