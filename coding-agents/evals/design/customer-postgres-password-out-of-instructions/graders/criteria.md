---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Has the Agent declare the password as a secret environment variable with no value (for example an `env` entry with `is_secret: true`), so neither the Agent nor its instructions hold it.
- Saves each password in a vault, found by its name when a run starts (for example `stigmer vault set-secret` or the SDK's `setSecrets`), never typed on the command line.
- Keeps each customer's password apart under the same name, for example a vault per customer named on that customer's conversations or routines, or a child organization per customer.
- Says psql, run as the Agent's shell command, gets the password as an environment variable because the Agent declares it.

**FAIL if**

- It leaves the password in the instructions, a Skill, an Environment, a routine's message, or a plain `value` in `env`.
- It says an Environment holds secrets.
- It invents an Agent field that holds vaults or secrets (an Agent carries no vaults).
- It puts all 40 customers' passwords in one vault every customer's conversations can use.
- It gives a per-customer vault Organization visibility in an Organization several customers share.
- It recommends passing the password in a message or a note.
- It invents CLI flags, such as `--value`, that put the secret on the command line.

**Welcome**

- Shell commands receive only the Agent's own declared keys, never a tool's login or a key a tool declares.
- A saved value is never shown again.
- In one Organization shared by several customers, a customer's vault must not have Organization visibility; a child organization per customer is the other documented setup.
- Rotating is saving the same name again, and it reaches the next run.
- A run whose key no vault holds is refused before it starts, naming the key.
- A run's `credentials.sources` shows which vault each key came from.
- Connect links serve keys that are a customer's own login to a tool.
- The declared name can be such as `CUSTOMER_DB_PASSWORD`, or a whole connection-string secret; a plain setting such as the host may carry its `value`.
- The value is read from a hidden prompt, a file or an environment variable.
- Creating each customer's vault with `--external-id` set to their customer id.
