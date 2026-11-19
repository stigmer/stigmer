# Agent guide: deploy/operator

The Stigmer operator: a standalone Go module whose controller turns one
`Stigmer` resource into a running install. This guide is an index; the headers
it names are the truth.

## Read in this order

- `README.md`: what the operator runs, how to build and test it, and where the
  install test lives.
- `api/v1/stigmer_types.go` header: the resource, why a field arrives only with
  the code that acts on it, and which rules are the API server's (CEL) versus
  the operator's (status).
- `api/v1/component_reason.go`: the reasons status carries, as constants, each
  with its sentence.
- `internal/component/component.go` header: the component contract, the two
  readers (cached and direct) and when each is used; then `apply.go`,
  `prerequisite.go`, `notready.go`, `secrets.go`.
- `internal/controller/stigmer_controller.go` header: the walk, the
  whole-install refusals, one status write per pass.
- `internal/render/env.go` and `internal/render/parity_test.go`: the server's
  and the runner's settings and the Compose parity contract that holds them to
  `docker-compose.yml`.
- `internal/manifests/README.md`: the embedded CloudNativePG release, its Barman
  Cloud backup plugin and the Temporal chart, and how to move them.
- `internal/render/backup.go`, `internal/component/backup.go` and
  `internal/component/upgrade.go`: backups to the bucket, restores, and the
  backup an upgrade waits for.

## Laws

- Generated files are never edited by hand: `api/v1/zz_generated.deepcopy.go`,
  `config/crd/bases/`, `config/rbac/role.yaml`, and their copies in
  `deploy/helm/stigmer-operator/crds/` and
  `deploy/helm/stigmer-operator/files/`. Run `make manifests generate` here;
  `make generated-check` fails a stale copy.
- A reason is a constant in `api/v1/component_reason.go` with a sentence in
  `ReasonMessages`; never a string literal at a call site. A released reason is
  never renamed.
- Every refusal and every wait is a sentence that names the object and the next
  step. A declaration that cannot be carried out is a `Refused` result, never a
  returned error; an error is only what the operator retries.
- Everything namespaced that the operator makes is owned by the `Stigmer`
  through `component.Apply`, except the keys Secret, which must outlive it.
  Cluster-level prerequisites go through `component.ApplyShared` and are never
  owned.
- A server or runner setting a self-hoster sets reaches the `Stigmer` resource
  (or `extraEnv`). `docker-compose.yml` is the canonical topology: a setting
  added there and not rendered here fails `internal/render/parity_test.go`.
- A declared bucket means backups. The backup plugin needs cert-manager, which
  the operator detects and never installs: without it the database is refused in
  words naming the command. A new database never names the plugin before it
  serves, and a failing backup never takes the install out of Ready (the
  `BackupHealthy` condition says so instead).
- The operator never caches Secrets it did not label; an adopter's Secret is
  read by name through `Env.Reader`.
- Nothing private in this public repository: no internal tracker ids, no private
  paths, no names of other products.

## Verification

`make lint-operator test-operator` from the repository root; a behaviour change
also runs `make smoke-operator PROFILE=bundled` (the install test on kind), and
a change to the bucket, backups or upgrades `PROFILE=bucket` and
`PROFILE=upgrade`.
