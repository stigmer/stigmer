# Embedded prerequisites

The operator binary carries these files, so an install needs no network path
to GitHub or a chart repository, and a given operator version always installs
the same prerequisites.

| File | What it is | Where it comes from |
| --- | --- | --- |
| `cloudnative-pg/release.yaml` | CloudNativePG's release manifest: its definitions, its controller in `cnpg-system`, its webhooks and roles. Installed when the cluster has no CloudNativePG and `spec.prerequisites.postgresOperator` is `auto`. | `https://github.com/cloudnative-pg/cloudnative-pg/releases`, at `CLOUDNATIVE_PG_VERSION` in the module's `Makefile` |
| `temporal/temporal-<version>.tgz` | Temporal's own Helm chart, rendered in memory for the bundled Temporal. Its `appVersion` is the Temporal server version `docker-compose.yml` runs, and the Compose parity test holds the two equal. | `https://github.com/temporalio/helm-charts/releases`, at `TEMPORAL_CHART_VERSION` in the module's `Makefile` |

Both are vendored unmodified. To move one, change its version in the
`Makefile`, run `make vendor-cloudnative-pg` or `make vendor-temporal-chart`
in `deploy/operator`, and run the module's tests and the operator's install
test: a new Temporal chart must still render the stores, the namespace and the
images the tests assert.
