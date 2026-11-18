What a good answer may also say. Never graded: leaving any of it out fails nothing.

- An Agent whose MCP servers sit at other hosts needs those hosts listed, or **Also allow this Agent's MCP servers**.
- A conversation keeps the Environment it started with.
- Run settings, or `status.environment_source`, show which Environment a conversation got.
- An Environment never holds secrets.
- Environments don't apply to a conversation on the person's own machine, and a server whose sandboxes can't enforce a list or install packages says so.
- An Organization admin makes the Environment in the console under **Library → Environments**, or as a `kind: Environment` manifest applied with `stigmer apply -f`.
- Without package registries allowed, the server refuses an Environment with packages and limited networking; the console's option is **Also allow package registries and code hosts**.
- The Agent's default is `environment_ref` on the Agent, or set on the Agent's page.
