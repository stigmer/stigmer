---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says a runner is not a resource (nothing to apply or register): it takes runs from a Temporal task queue, and the server never picks or calls it.
- Says neither the compose stack nor the Helm chart runs the shared runner on another machine today, because the server and the runner share file storage by disk, and the guides don't teach running a second shared runner.
- Says the platform's way to move Agent work off the server's machine is a runner per Session through a sandbox provisioner, but the shipped stack cannot exercise it yet, so it is not a procedure for compose today.

**FAIL if**

- It presents running the `stigmer-runner` container on another host against the server and Temporal as a supported setup.
- It invents a runner registration command, resource or setting.
- It says the server pushes work to a runner it picks.
- It tells them to edit `docker-compose.yml`.
- It presents the `docker` sandbox driver on the shipped compose stack as working today (the published server image carries no `docker` CLI and the compose file mounts no Docker socket, so it fails at its first Session).

**Welcome**

- Each sandboxed runner reaches the server only, never Temporal.
- The Helm chart on a cluster with bigger nodes.
- Environments for the packages a sandbox installs, such as pandas.
- The desktop app's own runner, which takes work only when the server routes runs per conversation (`STIGMER_ACTIVITY_ROUTING=session`).
- The LLM key lives with the runner, never the server.
- The task queue is `stigmer_runner`; the shared-storage limit is tracked as stigmer#1099.
- The provisioner is `SANDBOX_PROVISIONER_TYPE`: `docker`, `agent-sandbox` on Kubernetes, or `substrate`; `local-process` stays on the same machine.
