---
type: llm
---

PASS if the answer moves the password out of the Agent and into a vault, in the docs' terms:
- The Agent declares the key in its `env` map as a secret (`is_secret: true`, under a name such as `CUSTOMER_DB_PASSWORD` or a whole connection-string secret) with no value: a secret declaration cannot carry a value, and the Agent stays a blueprint with no secrets in it. A plain, non-secret setting such as the host may carry its `value`.
- The value is saved in a vault and found by its name when a run starts, from the vaults the conversation uses. It is saved with `stigmer vault set-secret <NAME> --vault <slug>` (or the SDK's `setSecrets`), reading the value from a hidden prompt, a file or an environment variable, never typed on the command line; a saved value is never shown again.
- With one database per customer, each customer gets its own shared vault (for example created with `--external-id` set to their customer id), and the conversations for that customer name that customer's vault; in one Organization shared by several customers a customer's vault must not have Organization visibility (a child organization per customer is the other documented setup).
- The shell command (psql) receives the secret because the Agent declares it: shell commands get only the Agent's own declared keys.

Welcome but optional: rotating is saving the same name again and reaches the next run; a run whose key no vault holds is refused before it starts, naming the key; a run's `credentials.sources` shows which vault each key came from; Connect links for keys that are a customer's own tool login.

FAIL if it leaves the password in the instructions, a Skill, an Environment, a routine's message or a plain `value` in `env`; says an Environment holds secrets; invents an Agent field that holds vaults or secrets (an Agent carries no vaults); puts all 40 customers' passwords in one vault every customer's conversations can use, or gives a per-customer vault Organization visibility in a shared Organization; recommends passing the password in a message or a note; or invents CLI flags such as `--value` that put the secret on the command line.
