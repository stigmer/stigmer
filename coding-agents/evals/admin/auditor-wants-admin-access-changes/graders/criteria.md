---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Points to the access history, which records every time someone was given or lost a role in the Organization or on anything in it, with who made the change and when.
- Says they can download it as a JSON Lines file (for example `stigmer access-history export` or **Download JSON Lines** under **Settings > Access history**) and filter it for Admin changes since January.
- Says that on Stigmer Cloud reading the history is part of the Enterprise Cloud plan; on the Team plan it is still recorded, so after upgrading they read the whole past.

**FAIL if**

- It calls the access history an audit log of everything people did.
- It says the Team plan does not record it.
- It says members can read it.
- It invents a filter flag the CLI does not have (such as `--role` or `--since`).
- It tells them to build their own log from other data.

**Welcome**

- Only the Organization's owners and admins read it, in **Settings > Access history** or with `stigmer access-history list`.
- Each line has `change`, `cause`, `actor`, `principal`, `role`, `resource`, `occurredAt` and `sequence`.
- It holds no sign-ins or settings changes.
- `stigmer access-history export --after <sequence>` keeps a copy current.
- A scheduled tool needs an Admin service account's key.
- Each change also records why it happened (its cause).
- The exported file lists changes oldest first; `stigmer access-history export > file.jsonl` writes it to a file.
