What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
