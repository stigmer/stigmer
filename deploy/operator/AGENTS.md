# Agent guide: deploy/operator

The Stigmer operator: a standalone Go module whose controller turns one
`Stigmer` resource into a running install. This guide is an index; the headers
it names are the truth.

## Read in this order

- `README.md`: what the operator runs, how to build and test it; its chart's own
  README, `deploy/helm/stigmer-operator/README.md`.
- `api/v1/stigmer_types.go` header: the resource, why a field arrives only with
  the code that acts on it, and which rules are the API server's (CEL) versus
  the operator's (status).
- `api/v1/component_reason.go`: the reasons status carries, each with its
  sentence.
- `internal/component/component.go` header: the component contract, the two
  readers (cached and direct) and when each is used; then `apply.go`,
  `prerequisite.go`, `notready.go`, `secrets.go`.
- `internal/controller/stigmer_controller.go` header: the walk, the
  whole-install refusals, one status write per pass.
- `internal/render/env.go` and `internal/render/parity_test.go`: the server's
  and runner's settings, held to `docker-compose.yml` by the parity test.
- `internal/manifests/README.md`: the embedded releases and how to move them.
- `internal/render/sandbox.go`, `internal/render/networkpolicy.go`,
  `internal/substrate/install/install.go`, `internal/janitor/janitor.go`
  headers: per-session sandboxes, fences, Substrate's install, and the cleanup
  once no `Stigmer` remains.
- `internal/render/backup.go`, `internal/component/backup.go` and
  `internal/component/upgrade.go`: backups to the bucket, restores, and the
  backup an upgrade waits for.

## Laws

- Generated files are never edited by hand: `api/v1/zz_generated.deepcopy.go`,
  `config/crd/bases/`, `config/rbac/role.yaml`, their copies in
  `deploy/helm/stigmer-operator/files/`, and the docs' reference page. Run
  `make manifests generate` here, then `make gen-operator-docs` at the root;
  `make generated-check` and `make gen-operator-docs-check` fail a stale copy.
- A reason is a constant in `api/v1/component_reason.go` with a sentence in
  `ReasonMessages`; never a string literal at a call site. A released reason is
  never renamed.
- Every refusal and wait is a sentence naming the object and the next step. A
  declaration that cannot be carried out is `Refused`, never a returned error;
  an error is only what the operator retries.
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
- Never cache a Secret the operator did not label; read an adopter's by name
  through `Env.Reader`.
- One hostname per install: the console at `/`, the API at its own paths (gRPC
  takes no prefix), sign-in at `/idp`, volume files at `/artifacts`; never a
  second host.
- Exposure signs people in, or says on purpose it does not
  (`spec.server.allowUnauthenticatedExposure`).
- Outbound calls go only to components the operator runs (`internal/keycloak`,
  `internal/serverhealth`).
- The sandbox pool is the declared size; the operator never sizes it from
  demand, which is the sandbox runtime's own autoscaler's job. A sandbox image
  is pinned by digest.
- The janitor deletes only what carries the operator's label, once no `Stigmer`
  remains.
- Nothing private in this public repository: no internal tracker ids, no private
  paths, no names of other products.

## Verification

`make lint-operator test-operator` from the repository root. A behaviour change
also runs the install test on kind, `make smoke-operator` with `PROFILE=` by
area: `bundled`; `bucket` and `upgrade` for the bucket, backups or upgrades;
`exposed` for the front door or sign-in; `agent-sandbox` for sandboxes, fences
or the janitor; `substrate` for Substrate.
