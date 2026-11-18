What a good answer may also say. Never graded: leaving any of it out fails nothing.

- It flags that the runner still sends each model call to the model provider on their key, and that the docs answer this by pointing the runner at a backend in their own cloud account (Vertex AI, Bedrock or Foundry) or sending Claude calls through their own LLM gateway (`ANTHROPIC_BASE_URL`); this is the mark of a strong answer.
- `stigmer up` and the all-in-one image are for building and trying it on a laptop, not for running it for real.
- A TLS reverse proxy goes in front of the stack before the team reaches it.
- First steps: follow the Docker Compose guide on the VM, then connect the CLI with `stigmer config backend add` and run a first Agent.
- Backups and upgrades are theirs: the durable volumes and `.env` are a complete backup.
- Open source is free under Apache 2.0.
- The compose stack runs Postgres, a real Temporal server, the server with the console and one runner.
