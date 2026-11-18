What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Names how it found the run: for example `stigmer list runs`, `stigmer get run <run-id>`, `stigmer runs logs <run-id>` or `stigmer get session <session-id>`.
- A failure on the Organization's own key is reported as that key's, with the provider's own message.
- On Stigmer Cloud, a key is replaced in the console's **Models & providers** or with `stigmer provider-key set anthropic` at a hidden prompt.
- On a Stigmer running on their own machine, the runner holds the key: `stigmer setup`, then `stigmer down && stigmer up`.
- Stigmer never runs a model call on a key of its own and never retries the call on another key.
