import { assertEquals } from "jsr:@std/assert@1";
import { groupFieldsToModerate, messageModerationInput, nextGroupState } from "./messaging.ts";

const newGroup = {
  name: null,
  description: null,
  image_path: null,
  pending_name: "Morning prayer",
  pending_description: "We pray at 7.",
  pending_image_path: "u1/0b7e7c2a-1111-4222-8333-944445555666.jpg",
  status: "pending",
};

Deno.test("messageModerationInput: the body, or an empty string", () => {
  assertEquals(messageModerationInput({ body: "hello" }), "hello");
  assertEquals(messageModerationInput({ body: null }), "");
});

Deno.test("groupFieldsToModerate skips null fields", () => {
  assertEquals(groupFieldsToModerate({ ...newGroup, pending_image_path: null }), [
    { field: "name", value: "Morning prayer" },
    { field: "description", value: "We pray at 7." },
  ]);
  assertEquals(
    groupFieldsToModerate({ ...newGroup, pending_name: null, pending_description: null }),
    [{ field: "image", value: newGroup.pending_image_path }],
  );
});

Deno.test("nextGroupState: a clean new group goes live and visible", () => {
  assertEquals(nextGroupState(newGroup, new Set()), {
    name: "Morning prayer",
    description: "We pray at 7.",
    image_path: newGroup.pending_image_path,
    pending_name: null,
    pending_description: null,
    pending_image_path: null,
    rejected_fields: [],
    status: "visible",
  });
});

Deno.test("nextGroupState: a flagged field keeps the live values and stays pending", () => {
  assertEquals(nextGroupState(newGroup, new Set(["description"])), {
    pending_description: null,
    rejected_fields: ["description"],
  });
});

Deno.test("nextGroupState: a clean edit of a visible group applies only what changed", () => {
  const live = {
    ...newGroup,
    name: "Old",
    description: "Old desc",
    image_path: "g/old.jpg",
    pending_description: null,
    pending_image_path: null,
    status: "visible",
  };
  assertEquals(nextGroupState(live, new Set()), {
    name: "Morning prayer",
    pending_name: null,
    rejected_fields: [],
  });
});

Deno.test("nextGroupState: a new group never goes visible without a name and a description", () => {
  assertEquals(nextGroupState({ ...newGroup, pending_description: null }, new Set()), {
    rejected_fields: ["description"],
  });
});
