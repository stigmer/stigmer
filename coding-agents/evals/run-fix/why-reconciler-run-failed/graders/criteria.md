---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Reports the cause read from the `reconciler` Agent's failed run: the model provider refused the call because the credit balance is too low to access the Anthropic API.
- Says the refusal concerns the Anthropic account behind the key the run used (the Organization's own provider key, or on a Stigmer running on their own machine the runner's key), not the Agent, the bank statement or Stigmer.
- Says the fix is to add credit or fix billing in that Anthropic account, or replace the key with one that has credit, and then run the reconciliation again.

**FAIL if**

- It gives a cause without having read the run.
- It blames the Agent's instructions, the bank statement, or a Stigmer plan or agent hours.
- It tells the person to buy Stigmer credits or upgrade a Stigmer plan.
- It asks them to paste an API key into the chat or pass it on the command line.
- It invents a command or flag the CLI reference does not list.

**Welcome**

- Names how it found the run: for example `stigmer list runs`, `stigmer get run <run-id>`, `stigmer runs logs <run-id>` or `stigmer get session <session-id>`.
- A failure on the Organization's own key is reported as that key's, with the provider's own message.
- On Stigmer Cloud, a key is replaced in the console's **Models & providers** or with `stigmer provider-key set anthropic` at a hidden prompt.
- On a Stigmer running on their own machine, the runner holds the key: `stigmer setup`, then `stigmer down && stigmer up`.
- Stigmer never runs a model call on a key of its own and never retries the call on another key.
