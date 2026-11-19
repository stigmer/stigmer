# The Stigmer operator

A Kubernetes operator that installs and runs Stigmer from one resource:

```yaml
apiVersion: stigmer.ai/v1
kind: Stigmer
metadata:
  name: stigmer
  namespace: stigmer
spec:
  owner:
    email: priya@acme.dev
  runner:
    llm:
      secretName: anthropic
```

From that, the operator mints the server's keys, runs Postgres (through
CloudNativePG, installed if the cluster has none), runs Temporal from Temporal's
own chart, and runs the Stigmer server with its shared runner.
`kubectl get stigmer` says in words what is ready and what it waits for.
External Postgres and Temporal, sign-in through your own identity provider, and
Stigmer Enterprise are declared on the same resource; `config/samples/` has one
of each.

One operator version runs one Stigmer version (the image tag is stamped into the
binary), and a cluster holds one operator and one `Stigmer`.

## What it needs

The operator holds cluster-wide rights: it installs definitions, cluster roles
and webhooks for the prerequisites it runs (CloudNativePG today). Its role is
generated from the controller's markers into `config/rbac/role.yaml`.

## Working on it

This is its own Go module, outside the repository's root `go.work` (the module's
`go.work` says why).

```sh
make help              # every target
make test              # unit and envtest suites (downloads envtest binaries)
make lint              # gofmt, go vet, go mod tidy, generated files current
make manifests generate
make docker-build      # ghcr.io/stigmer/stigmer-operator:compose-dev
```

From the repository root, `make build-operator`, `make test-operator`,
`make lint-operator`, and the install test on kind,
`make smoke-operator PROFILE=bundled` (also `byo` and `enterprise`), which lives
in `test/install/smoke-operator.mjs`.

The operator's chart is `deploy/helm/stigmer-operator`.
