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

Add `spec.ingress` with a hostname and Stigmer answers at that one name: the
console, the API, sign-in at `/idp` and files at `/artifacts`, Ready only once
its certificate is. A front door brings the bundled sign-in (Keycloak, its realm
kept converged by the operator), which creates the owner's account with a
one-time password and, with `spec.identity.bundled.signUp`, opens sign-up to
your email domains after the owner. The shared runner starts signed in. External
Postgres and Temporal, a bucket with backups, sign-in through your own identity
provider, and Stigmer Enterprise are declared on the same resource;
`config/samples/` has one of each.

With a bucket declared, `spec.sandboxes.driver: agentSandbox` runs each session
in a sandbox of its own instead of the shared runner: the operator installs
agent-sandbox if the cluster has none, makes a sandbox namespace beside the
install, and fences the sandboxes so they reach the server, the bucket and the
public internet but not the database, Temporal or other private addresses. The
pool of sandboxes is never sized from demand by the operator. Once no `Stigmer`
remains, the operator removes what it installed at the cluster level (the
sandbox namespace, agent-sandbox, the backup plugin, CloudNativePG) and leaves
anything someone else installed.

One operator version runs one Stigmer version (the image tag is stamped into the
binary), and a cluster holds one operator and one `Stigmer`.

## What it needs

The operator holds cluster-wide rights: it installs definitions, cluster roles
and webhooks for the prerequisites it runs (CloudNativePG, with a bucket
declared its Barman Cloud backup plugin, and agent-sandbox), deletes them and
the sandbox namespace it made once no `Stigmer` remains, and writes the fences
(NetworkPolicies). It reads Gateways and writes Ingresses, HTTPRoutes and
cert-manager Certificates for the front door, and it calls the bundled sign-in's
admin API at its in-cluster Service. Its role is generated from the controller's
markers into `config/rbac/role.yaml`.

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
`make smoke-operator PROFILE=bundled` (also `byo`, `enterprise`, `bucket`,
`exposed`, `agent-sandbox` and `upgrade`), which lives in
`test/install/smoke-operator.mjs`.

The operator's chart is `deploy/helm/stigmer-operator`.
