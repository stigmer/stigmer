What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The all-in-one container runs SQLite and Temporal's dev-server inside one container, and says it is for evaluation every time it starts.
- Every compose setting is a line in `.env`; the stack refuses to start without its three required values, `POSTGRES_PASSWORD`, `STIGMER_ENCRYPTION_KEY` and `STIGMER_RUNNER_TOKEN_KEY`.
- A TLS reverse proxy in front, forwarding HTTP/2 in the clear (h2c) to port 7234 and serving the API on port 443, with a second hostname for downloads.
- The three durable volumes (`postgres-data`, `artifacts`, `server-data`) plus `.env` are a complete backup.
- The Stigmer operator if they already run Kubernetes.
- The single image's other limits: no separate backups or scaling, and Temporal's dev-server is not built for durable history.
- The compose stack runs Postgres, a real Temporal server, the server with the console, and one runner.
