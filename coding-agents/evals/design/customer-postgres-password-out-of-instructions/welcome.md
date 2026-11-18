What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
