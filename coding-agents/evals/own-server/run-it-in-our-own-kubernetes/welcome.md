What a good answer may also say. Never graded: leaving any of it out fails nothing.

- A cluster at 1.30 or newer with a default storage class, `helm` 3, `kubectl` and the Stigmer CLI; cert-manager for backups and an issued certificate.
- The operator installs with `helm install stigmer-operator oci://ghcr.io/stigmer/charts/stigmer-operator`, once per cluster, and runs one `Stigmer` per cluster.
- `kubectl get stigmer` says in words what is ready and what it waits for.
- The operator keeps the server's keys in the Secret `stigmer-keys`, which outlives a delete and belongs in their backups.
- Postgres and Temporal come bundled or point at their own (`spec.database.postgresql.external`, `spec.temporal.external`), decided before the first install, since moving later is a database restore.
- A bucket (`spec.objectStore`) holds the files and the database's continuous backups, and lets each Session run in a sandbox of its own (agent-sandbox or Agent Substrate).
- Upgrading is `helm upgrade stigmer-operator`; with a bucket the operator takes a backup before the server rolls.
- The bundled sign-in creates the owner's account with a one-time password, then opens sign-up only to the email domains they declare.
- Open source holds one Organization; Stigmer Enterprise (a license key on the same resource) holds many.
