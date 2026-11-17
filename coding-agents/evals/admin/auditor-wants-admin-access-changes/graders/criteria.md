---
type: llm
---

PASS if the answer points to the access history, as the docs describe it: every time someone was given or lost a role in the Organization or on anything in it, who made the change, why (its cause) and when; read by the Organization's owners and admins in **Settings > Access history** or with `stigmer access-history list`, and exported as JSON Lines, oldest first, with `stigmer access-history export > file.jsonl` (each line has `change`, `cause`, `actor`, `principal`, `role`, `resource`, `occurredAt`, `sequence`), which they filter for the Admin role and the dates they need. It must say that on Stigmer Cloud reading the history is part of the Enterprise Cloud plan; on the Team plan it is still recorded, so after upgrading they read the whole past. Welcome but optional: it holds no sign-ins or settings changes; `export --after <sequence>` keeps a copy current; a scheduled tool needs an Admin service account's key.

FAIL if the answer calls it an audit log of everything people did, says the Team plan does not record it, says members can read it, invents a filter flag the CLI does not have (such as `--role` or `--since`), or tells them to build their own log from other data.
