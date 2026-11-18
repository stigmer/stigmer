---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the Free plan includes 30 agent hours a month and where to see the hours used and the reset date, for example **Settings > Billing** or `stigmer usage hours`.
- Says that at the allowance Free pauses new work until the first day of the month (UTC): a new message is refused with a note naming the date, and nothing past the allowance is billed.
- Says Stigmer never bills or prices model calls: Claude runs on their Organization's own Anthropic key, so what they spent on Claude is on their Anthropic account, not their Stigmer bill.

**FAIL if**

- It says Stigmer bills or marks up model calls.
- It gives a dollar figure for Claude spend taken from Stigmer.
- It says Free bills hours past the allowance.
- It presents numbers read from a server other than their Stigmer Cloud Organization as their standing.
- It invents a command or flag the CLI does not have.

**Welcome**

- An agent hour is an hour an Agent spends working (thinking, calling tools, writing files); waiting for a person never counts.
- A running turn may finish at the allowance; turns still running an hour past it are stopped.
- Token reports by model and Agent with `stigmer usage org --from ... --to ...` or the **Usage** page.
- Working time in usage reports can be more than agent hours.
- Free allows 5 Agents at once.
- Team and Business never pause: they bill the hours past the allowance at $0.40 an hour.
- **Settings > Billing** and `stigmer usage hours` also say what happens past the allowance.
- Stigmer's usage reports show only the tokens, never their cost.
