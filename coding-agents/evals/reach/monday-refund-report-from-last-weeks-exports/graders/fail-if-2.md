---
type: llm
---

PASS unless the answer does this:

It gives the routine's schedule in a field other than `cron` (`schedule:` and `every:` do not exist in Stigmer; a `time_zone` beside the cron is right), or a cron that is not Mondays at 9.
