---
type: llm
---

PASS if the answer says Stigmer never runs a model call on a key of its own and never prices or marks up tokens: every run uses the provider key of the Organization that owns the Agent (an Anthropic key, an OpenAI key, or your own compatible endpoint), and the model provider bills that Organization directly; and that what Stigmer Cloud charges is the plan's monthly fee plus any agent hours past the plan's allowance, with no line for model usage on the invoice, while a self-hosted server has no Stigmer billing at all and its runner calls the provider on your key. Welcome but optional: on Stigmer Cloud a child organization uses its parent's key for a provider it holds none of, and its own key for that provider wins, so a customer in a child organization of their own can run on their own key; usage reports count tokens but never price them; a cost cap (`max_cost_usd` in the Agent's run settings) stops a run at an estimated cost; shared Agents, channels and evals also run on the owning Organization's keys.

FAIL if it says Stigmer resells, marks up or bundles tokens; that model usage appears on the Stigmer invoice; that agent hours are a token charge; that Stigmer supplies a model or free credits; or invents a pass-through or customer-billing feature the docs don't name.
