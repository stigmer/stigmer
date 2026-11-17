---
type: llm
---

PASS if the agent finds the `reconciler` Agent's failed run on Stigmer (for example with `stigmer list runs`, `stigmer get run <run-id>`, `stigmer runs logs <run-id>` or `stigmer get session <session-id>`) and reports the real cause from it: the model provider refused the call because the credit balance is too low to access the Anthropic API. It must also say what to do: this is a failure on the Organization's own provider key, reported with the provider's own message, so the fix is in their Anthropic account (add credit / fix billing there) or replacing the key, and then running the job again. Replacing a key is done in the console's **Models & providers** or with `stigmer provider-key set anthropic` at a hidden prompt (Stigmer Cloud), or, on a Stigmer running on their own machine, with `stigmer setup` then `stigmer down && stigmer up` (the runner holds the key there). Saying that Stigmer never runs a model call on a key of its own and never retries on another key is welcome.

FAIL if the agent guesses a cause without reading the run, blames the Agent's instructions, the bank statement or a Stigmer plan or agent hours, tells the person to buy Stigmer credits or upgrade a Stigmer plan, asks them to paste an API key into the chat or pass it on the command line, or invents a command or flag the CLI reference does not list.
