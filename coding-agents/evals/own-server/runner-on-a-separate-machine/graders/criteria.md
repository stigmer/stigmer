---
type: llm
---

PASS if the answer says what the docs say about runners: a runner is not a resource (nothing to apply or register), it takes runs from a Temporal task queue (`stigmer_runner`) and the server never calls it; every shape starts exactly one runner beside the server; today neither the compose stack nor the chart runs the shared runner on another machine, because file storage is shared by disk between the server and the runner (tracked as stigmer#1099), and running a second shared runner is not something the guides teach. The supported way to move Agent work off the server's machine is a runner per Session through a sandbox provisioner (`SANDBOX_PROVISIONER_TYPE`: `docker`, `agent-sandbox` on Kubernetes, or `substrate`; `local-process` runs on the same machine), where each sandbox reaches the server only. Welcome but optional: the Helm chart on a cluster with bigger nodes; Environments for the packages a sandbox installs; the desktop app's own runner with `STIGMER_ACTIVITY_ROUTING=session`; that the LLM key lives with the runner.

FAIL if the answer presents running the `stigmer-runner` container on another host against the server and Temporal as a supported setup, invents a runner registration command, resource or setting, says the server pushes work to a runner it picks, or tells them to edit `docker-compose.yml`.
