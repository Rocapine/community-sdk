import { assertEquals } from "jsr:@std/assert@1";
import { pushCopy } from "./copy.ts";
import {
  dmPushPayload,
  groupFieldsToModerate,
  messageModerationInput,
  nextGroupState,
  readMessagingMode,
  translationRefusal,
} from "./messaging.ts";

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

Deno.test("messageModerationInput: no text in reportOnly (only an image is checked)", () => {
  assertEquals(messageModerationInput({ body: "x" }, "reportOnly"), "");
  assertEquals(messageModerationInput({ body: "x" }, "pre"), "x");
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

// messaging_settings read: one `.from().select().eq().single()` answering `result`.
const settingsClient = (result: { data: unknown; error: unknown }) =>
  ({
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) }) }),
  }) as unknown as Parameters<typeof readMessagingMode>[0];

Deno.test(
  "readMessagingMode: no messaging module is 'not installed', without logging",
  async () => {
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      for (const code of ["42P01", "PGRST205"]) {
        assertEquals(
          await readMessagingMode(settingsClient({ data: null, error: { code, message: "x" } })),
          { installed: false, mode: null },
        );
      }
    } finally {
      console.error = original;
    }
    assertEquals(logged.length, 0);
  },
);

Deno.test("readMessagingMode: the mode, or null on any other error", async () => {
  assertEquals(
    await readMessagingMode(
      settingsClient({ data: { settings: { moderation: "pre" } }, error: null }),
    ),
    { installed: true, mode: "pre" },
  );
  assertEquals(await readMessagingMode(settingsClient({ data: { settings: {} }, error: null })), {
    installed: true,
    mode: "post",
  });
  const original = console.error;
  console.error = () => {};
  try {
    assertEquals(
      await readMessagingMode(
        settingsClient({ data: null, error: { code: "57014", message: "x" } }),
      ),
      { installed: true, mode: null },
    );
  } finally {
    console.error = original;
  }
});

Deno.test("dmPushPayload: a request names no one and quotes nothing, whatever pushPreview", () => {
  const fr = pushCopy("fr");
  for (const preview of ["full", "sender", "none"]) {
    const p = dmPushPayload(fr, "request", preview, "Jean", "Secret", true);
    assertEquals(p, { body: "Tu as une nouvelle demande de message" }, preview);
  }
  // Anything but "message" is treated as a request (fail closed).
  assertEquals(dmPushPayload(fr, "other", "full", "Jean", "Secret", false).title, undefined);
});

Deno.test("dmPushPayload: a message follows pushPreview, the sender as title", () => {
  const fr = pushCopy("fr");
  assertEquals(dmPushPayload(fr, "message", "full", "Jean", "Salut", false), {
    title: "Jean",
    body: "Salut",
  });
  assertEquals(dmPushPayload(fr, "message", "full", "Jean", null, true).body, "📷 Photo");
  assertEquals(dmPushPayload(fr, "message", "full", "Jean", " ", false), {
    title: "Jean",
    body: "Jean t'a envoyé un message",
  });
  assertEquals(dmPushPayload(fr, "message", "sender", "Jean", "Secret", true), {
    title: "Jean",
    body: "Jean t'a envoyé un message",
  });
  assertEquals(dmPushPayload(fr, "message", "none", "Jean", "Secret", true), {
    body: "Tu as un nouveau message",
  });
  const long = dmPushPayload(fr, "message", "full", "Jean", "a".repeat(300), false).body;
  assertEquals(long.length, 120);
  assertEquals(long.endsWith("..."), true);
});

Deno.test("translationRefusal: the author is refused, whatever the cache holds", () => {
  const msg = { body: "hola", status: "visible", author_id: "u1" };
  assertEquals(translationRefusal(msg, "u1"), "own message");
  assertEquals(translationRefusal(msg, "u2"), null);
  assertEquals(translationRefusal({ ...msg, status: "pending" }, "u2"), "not found");
  assertEquals(translationRefusal({ ...msg, body: "  " }, "u2"), "not found");
  assertEquals(translationRefusal(null, "u2"), "not found");
});
