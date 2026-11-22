# The Stigmer operator

The Stigmer operator runs [Stigmer](https://stigmer.ai), the open-source backend
for the agents in your product, on Kubernetes from one `Stigmer` resource. You
install this chart once per cluster, declare what you want, and the operator
runs it: Postgres (archived to your bucket when you name one), Temporal, the
server and console, and, as you declare them, a front door with its certificate
and the bundled sign-in, and a sandbox of its own for each session.
`kubectl get stigmer` says in words what is ready and what it waits for.

## Install

```sh
helm install stigmer-operator oci://ghcr.io/stigmer/charts/stigmer-operator \
  --namespace stigmer-system --create-namespace
```

Then declare Stigmer in a namespace of its own, with the Secret that holds your
model provider's key:

```sh
kubectl create namespace stigmer
kubectl -n stigmer create secret generic anthropic --from-literal=ANTHROPIC_API_KEY=<your key>
kubectl apply -f - <<'EOF'
apiVersion: stigmer.ai/v1
kind: Stigmer
metadata:
  name: stigmer
  namespace: stigmer
spec:
  owner:
    email: you@example.com
  runner:
    llm:
      secretName: anthropic
EOF
kubectl -n stigmer get stigmer
```

The operator mints the server's keys, so that Secret is the only one you write.
The [Kubernetes guide](https://stigmer.ai/docs/guides/self-hosting/kubernetes)
walks the rest: a hostname with sign-in, a bucket with backups, your own
Postgres and Temporal, per-session sandboxes, Stigmer Enterprise. The
[Stigmer resource reference](https://stigmer.ai/docs/guides/self-hosting/kubernetes-reference/stigmer)
lists every field.

## Versions

The chart's version is the Stigmer version: operator `vX` runs Stigmer `vX`,
pulling every Stigmer image at that tag, and a cluster holds one operator and
one `Stigmer`. To move to a release:

```sh
helm upgrade stigmer-operator oci://ghcr.io/stigmer/charts/stigmer-operator \
  --namespace stigmer-system --version <X.Y.Z>
```

The upgrade applies the new `Stigmer` definition first, then the new operator,
which upgrades Stigmer. With a bucket declared, it takes a backup of the
database and waits for it before the server rolls.

## Values

The operator's own settings. Everything about Stigmer itself is declared on the
`Stigmer` resource.

| Value                                   | Default                                  | What it does                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.repository`                      | `ghcr.io/stigmer/stigmer-operator`       | The operator's image, for a mirror.                                                                                                                                                               |
| `image.tag`                             | `v<appVersion>`                          | Leave it empty: the tag is the release's.                                                                                                                                                         |
| `image.pullPolicy`, `image.pullSecrets` | `IfNotPresent`, none                     | How the operator's image is pulled. Stigmer's own images take `spec.image` on the resource.                                                                                                       |
| `replicas`                              | `1`                                      | One replica reconciles at a time (leader election); more only shorten a failover.                                                                                                                 |
| `resources`                             | 50m CPU and 128Mi requested, 512Mi limit | The operator's container.                                                                                                                                                                         |
| `logLevel`                              | `info`                                   | `info` or `debug`.                                                                                                                                                                                |
| `localRegistry`                         | empty                                    | For development clusters only: the in-cluster address of a local registry (`kind-registry:5000` on kind), through which Agent Substrate's node agent pulls a sandbox image built on your machine. |
| `nodeSelector`, `tolerations`           | none                                     | Where the operator runs.                                                                                                                                                                          |

## What it holds

The operator runs with cluster-wide rights, because it installs what Stigmer
needs when the cluster has none: CloudNativePG and its backup plugin,
agent-sandbox, and Agent Substrate with its definitions, roles, webhooks and
admission policy. It labels everything it installs and removes only what carries
its label, once no `Stigmer` remains. It writes the network fences
(NetworkPolicies) and the front door (an Ingress or an HTTPRoute, and a
cert-manager Certificate), reads the Secrets it is pointed at by name, and calls
only components it runs. Its role is generated from the controller's code.

## Uninstall

Delete the `Stigmer` first, while the operator runs, so it removes what it
installed:

```sh
kubectl -n stigmer delete stigmer stigmer
helm uninstall stigmer-operator --namespace stigmer-system
```

The keys Secret, your bucket and a certificate cert-manager issued outlive the
delete, so a restore stays possible. The `Stigmer` definition stays too; a later
install under the same release name and namespace adopts it, and
`kubectl delete customresourcedefinition stigmers.stigmer.ai` removes it.
