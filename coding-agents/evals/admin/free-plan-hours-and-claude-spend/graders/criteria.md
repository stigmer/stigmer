---
type: llm
---

PASS if the answer says: the Free plan includes 30 agent hours a month (an hour an Agent spends working: thinking, calling tools, writing files; waiting for a person never counts), and **Settings > Billing** or `stigmer usage hours` shows the hours used, the reset date and what happens past it; at the allowance Free pauses new work until the first day of the month (UTC): a new message is refused with a note naming the date, a running turn may finish, and turns still running an hour past the allowance are stopped. On the Claude spend: Stigmer counts tokens but never prices them; every model call runs on their Organization's own Anthropic key and Anthropic bills them directly, so the money is on their Anthropic account; Stigmer's usage reports (`stigmer usage org --from ... --to ...`, the Usage page) show the tokens by model and agent. Welcome but optional: working time in usage reports can be more than agent hours; Free allows 5 agents at once; a paid plan never pauses and bills extra hours.

FAIL if the answer says Stigmer bills or marks up model calls, gives a dollar figure for Claude spend from Stigmer, says Free bills hours past the allowance, presents numbers read from a server other than their Stigmer Cloud Organization as their standing, or invents a command or flag the CLI does not have.
