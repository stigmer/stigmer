What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Each sandboxed runner reaches the server only, never Temporal.
- The Helm chart on a cluster with bigger nodes.
- Environments for the packages a sandbox installs, such as pandas.
- The desktop app's own runner, which takes work only when the server routes runs per conversation (`STIGMER_ACTIVITY_ROUTING=session`).
- The LLM key lives with the runner, never the server.
- The task queue is `stigmer_runner`; the shared-storage limit is tracked as stigmer#1099.
- The provisioner is `SANDBOX_PROVISIONER_TYPE`: `docker`, `agent-sandbox` on Kubernetes, or `substrate`; `local-process` stays on the same machine.
