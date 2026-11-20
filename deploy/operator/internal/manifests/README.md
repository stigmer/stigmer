# Embedded prerequisites

The operator binary carries these files, so an install needs no network path to
GitHub or a chart repository, and a given operator version always installs the
same prerequisites.

| File                              | What it is                                                                                                                                                                                                                                                                                                                                        | Where it comes from                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cloudnative-pg/release.yaml`     | CloudNativePG's release manifest: its definitions, its controller in `cnpg-system`, its webhooks and roles. Installed when the cluster has no CloudNativePG and `spec.prerequisites.postgresOperator` is `auto`.                                                                                                                                  | `https://github.com/cloudnative-pg/cloudnative-pg/releases`, at `CLOUDNATIVE_PG_VERSION` in the module's `Makefile`           |
| `barman-cloud/manifest.yaml`      | CloudNativePG's Barman Cloud plugin release manifest: its `ObjectStore` definition, its controller in `cnpg-system`, and the cert-manager Issuer and Certificates its TLS uses. Installed when a bucket is declared, cert-manager is present and `spec.prerequisites.postgresBackupPlugin` is `auto`.                                             | `https://github.com/cloudnative-pg/plugin-barman-cloud/releases`, at `BARMAN_CLOUD_PLUGIN_VERSION` in the module's `Makefile` |
| `temporal/temporal-<version>.tgz` | Temporal's own Helm chart, rendered in memory for the bundled Temporal. Its `appVersion` is the Temporal server version `docker-compose.yml` runs, and the Compose parity test holds the two equal.                                                                                                                                               | `https://github.com/temporalio/helm-charts/releases`, at `TEMPORAL_CHART_VERSION` in the module's `Makefile`                  |
| `agent-sandbox/sandbox.yaml`      | agent-sandbox's core release manifest: its `Sandbox` definitions, its controller in `agent-sandbox-system` and its roles. Installed when `spec.sandboxes.driver` is `agentSandbox`, the cluster has no agent-sandbox and `spec.prerequisites.agentSandbox` is `auto`. Its version is the one the server's agent-sandbox driver is tested against. | `https://github.com/kubernetes-sigs/agent-sandbox/releases`, at `AGENT_SANDBOX_VERSION` in the module's `Makefile`            |

All four are vendored unmodified. To move one, change its version in the
`Makefile`, run `make vendor-cloudnative-pg`, `make vendor-barman-cloud-plugin`,
`make vendor-temporal-chart` or `make vendor-agent-sandbox` in
`deploy/operator`, and run the module's tests and the operator's install test: a
new Temporal chart must still render the stores, the namespace and the images
the tests assert.
