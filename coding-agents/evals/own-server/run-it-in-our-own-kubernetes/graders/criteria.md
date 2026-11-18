---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says Stigmer runs entirely on their own cluster through its Helm chart, with no Stigmer Cloud involved.
- Says a Secret holding the server's keys and the Postgres password (for example `STIGMER_ENCRYPTION_KEY`) is created before the install, because the chart refuses to install without it.
- Says a fresh install trusts every caller, so it stays private (for example behind `kubectl port-forward`) until authentication is turned on with their own OIDC provider, and the chart refuses an Ingress until then.

**FAIL if**

- It invents a Kubernetes operator or custom resources for the stack.
- It tells them to edit the chart's templates.
- It says to expose the stack publicly before authentication is on.
- It puts the LLM provider key in the server's settings instead of the runner's Secret.
- It says they must use Stigmer Cloud.
- It names Helm values the chart does not have.

**Welcome**

- A cluster at 1.27 or newer with a default storage class, `helm` 3, `kubectl` and the Stigmer CLI.
- The LLM provider key goes in a Secret of its own named by `runner.llm.existingSecret`: the runner holds it, never the server.
- Postgres and Temporal come bundled or point at their own (`externalDatabase`, `externalTemporal`), decided before the first install, since moving later is a database restore.
- The server and the runner are one pod, with one runner replica.
- A complete backup is the three durable claims, the Secret and the values file.
- The chart version is the Stigmer version.
- Open source holds one Organization; Stigmer Enterprise (a license key on the same chart) holds many.
- The chart is `oci://ghcr.io/stigmer/charts/stigmer`, installed with one values file.
- The Secret holds `STIGMER_ENCRYPTION_KEY`, `STIGMER_RUNNER_TOKEN_KEY` and `POSTGRES_PASSWORD`.
- The chart also refuses a public Service until authentication is on.
