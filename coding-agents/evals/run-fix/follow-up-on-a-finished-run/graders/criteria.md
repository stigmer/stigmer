---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the follow-up goes into the same Session (the conversation) the finished run belongs to, where the Agent sees the whole conversation so far, so nothing starts fresh.
- Names `stigmer resume` as the way to send it from a terminal: it opens the Session, shows the conversation and takes the new message.
- Says how to reach that Session, for example `stigmer resume <session-id>` with the full id (from `stigmer list sessions` or `stigmer get run <run-id>`), or the picker a bare `stigmer resume` or a subject search opens.

**FAIL if**

- It says running `stigmer run invoice-checker` again continues the same conversation.
- It invents a flag the CLI reference does not list, for example `stigmer run --session`, or `-m`/`--message` on `stigmer resume`.
- It says a finished run cannot take a follow-up.
- It tells them to send the follow-up with `stigmer runs resume <run-id>`, which continues a paused run, not a finished conversation.

**Welcome**

- Each message in a Session is one run, and a follow-up is a new run in the same Session.
- `stigmer resume` refuses a partial Session id: the id must be given in full.
- The conversation keeps the vaults, plugins and harness it was started with.
- `stigmer download session <session-id>` gets what every turn of the conversation saved.
- From code, the follow-up is a message sent to the existing Session through the SDK.
