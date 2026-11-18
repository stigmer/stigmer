What a good answer may also say. Never graded: leaving any of it out fails nothing.

- A Harness is the loop that runs a Session's turns.
- The Harness is chosen per Session when it is created (defaulting to the Agent's `harness` run setting, else Stigmer's) and cannot be switched once the first run starts.
- What Claude Agent does not offer yet: background commands, built-in web fetch and search, the fast tier.
- Neither harness carries a Stigmer charge.
- The Stigmer harness gives explicit control of prompt caching.
- Keys are added in Models & providers, or with `stigmer provider-key set`.
- `--harness claude` on `stigmer run`.
- The default harness is named `stigmer`, Claude Agent is `claude`, and an OpenAI-compatible endpoint's models are named `openai:<name>`.
