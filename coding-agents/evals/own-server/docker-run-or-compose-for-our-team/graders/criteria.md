---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the single image is for evaluation only, not the team's daily use, giving at least one of the docs' reasons (for example no sign-in, so every caller is trusted, or upgrades kill in-flight runs).
- Says the Docker Compose stack is the production path for a team on one machine, so the person leaning towards compose is right.
- Says sign-in must be turned on with their own OIDC provider, behind a TLS proxy, before the team reaches the stack, because a fresh stack trusts every caller who can reach it.

**FAIL if**

- It recommends the all-in-one image for the team's daily use.
- It says the all-in-one image can turn sign-in on.
- It tells them to edit `docker-compose.yml` to change a setting instead of a line in `.env`.
- It invents a production mode, flag or setting for the single image.

**Welcome**

- The all-in-one container runs SQLite and Temporal's dev-server inside one container, and says it is for evaluation every time it starts.
- Every compose setting is a line in `.env`; the stack refuses to start without its three required values, `POSTGRES_PASSWORD`, `STIGMER_ENCRYPTION_KEY` and `STIGMER_RUNNER_TOKEN_KEY`.
- A TLS reverse proxy in front, forwarding HTTP/2 in the clear (h2c) to port 7234 and serving the API on port 443, with a second hostname for downloads.
- The three durable volumes (`postgres-data`, `artifacts`, `server-data`) plus `.env` are a complete backup.
- The Helm chart if they already run Kubernetes.
- The single image's other limits: no separate backups or scaling, and Temporal's dev-server is not built for durable history.
- The compose stack runs Postgres, a real Temporal server, the server with the console, and one runner.
