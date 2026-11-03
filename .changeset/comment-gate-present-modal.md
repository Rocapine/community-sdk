---
"@rocapine/community-ui": patch
---

`beforeSubmitComment` gets a second argument, `{ presentModal }`: a gate that shows its own sheet (e.g. sign-in) opens it through `presentModal`, which closes the thread first and opens the sheet once it is gone. iOS can't present a Modal over the thread's, so opening it directly showed nothing and left an invisible layer that froze the app. Resolving `true` after the sheet still sends the comment. New exported types: `CommentGate`, `PresentModal`.
