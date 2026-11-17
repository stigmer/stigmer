---
type: llm
---

PASS if the answer explains that each message is one run inside a Session (the conversation), and a follow-up goes to that same Session, where the Agent sees the whole conversation so far: find the Session id (`stigmer get run <run-id>` shows the run's session, or `stigmer list sessions`), then `stigmer resume <session-id>` with the full id, which shows the conversation and takes a new message on a terminal (browsing with a bare `stigmer resume` is fine too). Welcome but optional: the conversation keeps the vaults, plugins and harness it was started with; `stigmer download session <id>` gets what every turn saved; from code, a message is sent to the existing Session through the SDK.

FAIL if the answer says `stigmer run invoice-checker` again continues the same conversation, invents a flag the CLI reference does not list (for example `stigmer run --session`, or `-m`/`--message` on `stigmer resume`), or says a finished run cannot take a follow-up.
