---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says GPT and Claude models both run on Stigmer's default harness on the Organization's own OpenAI and Anthropic keys, and a model the catalog doesn't list, such as Gemini, is reached through their own OpenAI-compatible endpoint.
- Says Claude Agent is Anthropic's Claude Agent SDK as the Harness and runs Claude models only, on the Organization's own Anthropic key, so it cannot serve the GPT or Gemini customers.
- Says when to pick Claude Agent: when they want Anthropic's own loop on Claude models; otherwise Stigmer's harness, with the widest model choice, is the default.

**FAIL if**

- It says Claude Agent runs GPT or Gemini.
- It says Stigmer has a native Gemini key slot.
- It says the Harness can be changed mid-conversation.
- It says a harness carries a Stigmer charge.
- It says Stigmer provides a model of its own.

**Welcome**

- A Harness is the loop that runs a Session's turns.
- The Harness is chosen per Session when it is created (defaulting to the Agent's `harness` run setting, else Stigmer's) and cannot be switched once the first run starts.
- What Claude Agent does not offer yet: background commands, built-in web fetch and search, the fast tier.
- Neither harness carries a Stigmer charge.
- The Stigmer harness gives explicit control of prompt caching.
- Keys are added in Models & providers, or with `stigmer provider-key set`.
- `--harness claude` on `stigmer run`.
- The default harness is named `stigmer`, Claude Agent is `claude`, and an OpenAI-compatible endpoint's models are named `openai:<name>`.
