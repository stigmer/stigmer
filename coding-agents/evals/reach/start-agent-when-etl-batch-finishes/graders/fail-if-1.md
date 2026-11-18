---
type: llm
---

PASS unless the answer does this:

It gives a per-routine webhook URL or secret token, a command such as `stigmer routine trigger` or `stigmer routine run`, or a request field other than `id` and `text` (such as `batch_id`, `note` or `input`).
