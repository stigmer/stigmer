---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Chooses self-hosting on their own machines, not Stigmer Cloud: Stigmer open source, or Stigmer Enterprise, the same server with a license key, if they need many Organizations, Teams or federation.
- Names the Docker Compose stack on one of their VMs as the way to run it for real, with its settings and keys in a `.env` file.
- Says a fresh install trusts every caller who can reach it, so the stack stays on a private network until authentication is turned on with their own OIDC provider.

**FAIL if**

- It recommends Stigmer Cloud or its Enterprise Cloud plan (both run by Stigmer).
- It deploys `stigmer up` or the all-in-one image as their production server.
- It says Kubernetes is required.
- It claims Stigmer hosts a model, so nothing leaves their servers.
- It exposes an unauthenticated server beyond a private network.
- It writes a key or secret into the repository.

**Welcome**

- It flags that the runner still sends each model call to the model provider on their key, and that the docs answer this by pointing the runner at a backend in their own cloud account (Vertex AI, Bedrock or Foundry) or sending Claude calls through their own LLM gateway (`ANTHROPIC_BASE_URL`); this is the mark of a strong answer.
- `stigmer up` and the all-in-one image are for building and trying it on a laptop, not for running it for real.
- A TLS reverse proxy goes in front of the stack before the team reaches it.
- First steps: follow the Docker Compose guide on the VM, then connect the CLI with `stigmer config backend add` and run a first Agent.
- Backups and upgrades are theirs: the durable volumes and `.env` are a complete backup.
- Open source is free under Apache 2.0.
- The compose stack runs Postgres, a real Temporal server, the server with the console and one runner.
