What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Only the Organization's owners and admins read it, in **Settings > Access history** or with `stigmer access-history list`.
- Each line has `change`, `cause`, `actor`, `principal`, `role`, `resource`, `occurredAt` and `sequence`.
- It holds no sign-ins or settings changes.
- `stigmer access-history export --after <sequence>` keeps a copy current.
- A scheduled tool needs an Admin service account's key.
- Each change also records why it happened (its cause).
- The exported file lists changes oldest first; `stigmer access-history export > file.jsonl` writes it to a file.
