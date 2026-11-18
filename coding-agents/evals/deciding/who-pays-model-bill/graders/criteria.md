---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says Stigmer does not resell, price or mark up tokens, and never runs a model call on a key of its own.
- Says every run uses the provider key of the Organization that owns the Agent (an Anthropic key, an OpenAI key, or its own compatible endpoint), and the model provider bills that Organization directly.
- Says the Stigmer Cloud invoice carries the plan's monthly fee plus any agent hours past the allowance, and never a line for model usage.

**FAIL if**

- It says Stigmer resells, marks up or bundles tokens.
- It says model usage appears on the Stigmer invoice.
- It says agent hours are a token charge.
- It says Stigmer supplies a model or free credits.
- It invents a pass-through or customer-billing feature the docs don't name.

**Welcome**

- On Stigmer Cloud a child organization uses its parent's key for a provider it holds none of, and its own key for that provider wins, so a customer in a child organization of their own can hold a key of their own.
- Usage reports count tokens but never price them.
- A cost cap (`max_cost_usd` in the Agent's run settings) stops a run at an estimated cost.
- Shared Agents, channels and evals also run on the owning Organization's keys.
- A self-hosted server has no Stigmer billing at all, and its runner calls the provider on their key.
