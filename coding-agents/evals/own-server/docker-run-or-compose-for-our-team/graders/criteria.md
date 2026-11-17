---
type: llm
---

PASS if the answer says the single image (the all-in-one container) is for evaluation only: one container with SQLite and Temporal's dev-server, no separate backups or scaling, an upgrade kills in-flight runs, and no sign-in (every caller is trusted); and that the Docker Compose stack is the production path for a team on one machine: Postgres, a real Temporal server, the server with the console and one runner, every setting a line in `.env` (three required values: `POSTGRES_PASSWORD`, `STIGMER_ENCRYPTION_KEY`, `STIGMER_RUNNER_TOKEN_KEY`), a TLS proxy in front, and authentication turned on with their own OIDC provider before the team reaches it. Welcome but optional: the three durable volumes plus `.env` are a complete backup; the Helm chart if they already run Kubernetes.

FAIL if the answer recommends the all-in-one image for the team's daily use, says it can turn sign-in on, tells them to edit `docker-compose.yml` to change settings, or invents a production mode of the single image.
