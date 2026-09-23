# Stigmer on Kubernetes

The open-source Stigmer stack as a Helm chart: the server with the web console,
the runner, and Postgres and Temporal bundled or yours. It is the
[Docker Compose stack](../../../docker-compose.yml) translated. The same four
parts run, the same environment variables are set (a test holds the two equal,
name for name), the same keys are yours to supply, and the same things make up a
backup.

Free, Apache 2.0, one organization. The Enterprise edition uses this same chart
with more values; those values are reserved here and refused until that edition
ships.

## What you get

- **One pod** with two containers: the **server** (API, console, artifact file
  server) and the **runner** (executes agents and workflows, holds your LLM
  key). They share the pod network and an artifact disk, the way `stigmer up`
  shares one laptop and Compose shares one host.
- **Postgres**, bundled as one `postgres:16` instance with one disk (one team's
  posture), or yours through `externalDatabase`.
- **Temporal**, bundled as one `temporalio/auto-setup` pod, or yours through
  `externalTemporal`. For production Temporal,
  [Temporal's own chart](https://github.com/temporalio/helm-charts) is the path.
- **Your keys, explicitly.** The chart refuses to install until you name a
  Secret with the two server keys (and the database password when Postgres is
  bundled). The server never generates keys into a disk you did not know about.
- **State that survives `helm uninstall`.** Every disk the chart creates is
  kept; a later install of the same release name adopts it.
- **Kubernetes 1.27 or newer**, on amd64 and arm64.

## Install

Create the Secret, then install:

```bash
kubectl create namespace stigmer
kubectl -n stigmer create secret generic stigmer-secrets \
  --from-literal=STIGMER_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  --from-literal=STIGMER_RUNNER_TOKEN_KEY=$(openssl rand -base64 32) \
  --from-literal=POSTGRES_PASSWORD=$(openssl rand -hex 24)

helm install stigmer oci://ghcr.io/stigmer/charts/stigmer \
  --namespace stigmer \
  --set secrets.existingSecret=stigmer-secrets \
  --wait
```

`STIGMER_ENCRYPTION_KEY` encrypts secret values at rest (environment variables,
OAuth tokens). `STIGMER_RUNNER_TOKEN_KEY` signs the execution-scoped tokens the
runner authenticates with. Both are 32 random bytes, base64-encoded. Keep the
Secret with your backups: without the encryption key, every encrypted value in
the database is unreadable.

The Secret may also carry `STIGMER_PLATFORM_TOKEN_KEY`, the RSA key that signs
the short-lived user tokens PlatformClients mint once authentication is on
(base64 of a PKCS#8 PEM:
`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 | tr -d '\n'`).
It is optional: without it the server generates one on its volume, and losing it
only means tokens minted in the last 15 minutes are minted again.

Then reach the console:

```bash
kubectl -n stigmer port-forward svc/stigmer 7234:7234 7235:7235
open http://localhost:7234
```

Without an Ingress there is no authentication and the console is reachable only
through that port-forward; every caller that can reach the port has full
control. That is the laptop posture, and fine for trying it. For a team, add an
Ingress and turn authentication on (below).

Give the runner an LLM key so agents can run (workflows without agent tasks run
key-free):

```bash
kubectl -n stigmer create secret generic stigmer-llm-keys --from-literal=ANTHROPIC_API_KEY=sk-ant-...
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reuse-values \
  --set runner.llm.existingSecret=stigmer-llm-keys
```

## Reach it from outside the cluster

Set `ingress.enabled` and two hostnames: one for the API and console, one for
artifact downloads. The two are separate because the artifact lane is its own
listener whose storage keys carry full paths, so it cannot share a host by path
prefix.

```yaml
ingress:
  enabled: true
  className: nginx
  api:
    host: stigmer.example.com
    tlsSecretName: stigmer-api-tls
    annotations:
      # ingress-nginx: the CLI and SDKs speak gRPC, which needs HTTP/2 to the
      # upstream. Without this the console and curl work and the CLI fails
      # with "missing status". With it every lane works.
      nginx.ingress.kubernetes.io/backend-protocol: "GRPC"
  artifacts:
    host: artifacts.stigmer.example.com
    tlsSecretName: stigmer-artifacts-tls
```

With an Ingress, the URLs the server mints for browsers and the CLI
(`SKILL_TRANSFER_BASE_URL`, `ARTIFACT_LOCAL_SERVE_URL`) follow the hosts,
`https` once a host has a TLS Secret. Set `server.publicUrl` and
`server.artifactPublicUrl` yourself if you front the Service another way.

Point the CLI at the API host on port 443 (the CLI picks `https` for `:443`):

```bash
export STIGMER_SERVER_ADDRESS=stigmer.example.com:443
```

## Authentication

Authentication is on when `server.oidc.issuer` and `server.oidc.audience` are
set, and the console signs in through the public PKCE client named in
`server.oidc.consoleClientId`. The full walk-through, including what to register
at your identity provider, is the
[authentication guide](https://stigmer.ai/docs/guides/self-hosting/authentication).

With authentication on, the runner needs an API key to call the server, and an
API key can only be minted by a signed-in operator. The key is the runner's own
credential (it fetches its configuration and the model registry with it); it
does not decide whose runs the runner may serve or who is recorded as running
them. For each run the server hands the runner a credential for that run alone,
so every member's run executes and is attributed to the member who started it,
whoever's key the runner process holds. An authenticated install is two steps,
and the chart refuses the half state in between:

1. Install with `server.oidc` unset. Sign in through the port-forward as the
   operator and mint the runner's key: `stigmer apikey create --name runner`.
2. Put the key in a Secret and upgrade with OIDC on:

```bash
kubectl -n stigmer create secret generic stigmer-runner-token --from-literal=STIGMER_TOKEN=stk_...
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reuse-values \
  --set server.oidc.issuer=https://your-issuer.example.com \
  --set server.oidc.audience=https://stigmer.example.com \
  --set server.oidc.consoleClientId=stigmer-console \
  --set runner.stigmerToken.existingSecret=stigmer-runner-token
```

Register the console's redirect URI at your provider:
`https://stigmer.example.com/auth/callback`, and the post-logout redirect
`https://stigmer.example.com/login`.

## Bring your own Postgres and Temporal

```yaml
postgres:
  enabled: false
externalDatabase:
  host: db.internal.example.com
  port: 5432
  user: stigmer
  database: stigmer
  existingSecret: stigmer-db # holds the password
  passwordKey: password
temporal:
  enabled: false
externalTemporal:
  hostPort: temporal-frontend.temporal.svc.cluster.local:7233
  namespace: default
```

The server's `DATABASE_URL` is assembled inside the container from these values
and the password Secret, so the password never appears in rendered manifests.
When Temporal stays bundled and Postgres is yours, Temporal's `auto-setup`
creates its two databases (`temporal`, `temporal_visibility`) on your instance
at first boot and needs a user with `CREATE DATABASE`.

## Backup, restore, upgrade

A complete backup is four things: the database (the bundled Postgres's disk, or
yours), the `<release>-artifacts` disk, the `<release>-server-data` disk, and
the Secret you created. The `<release>-runner-data` disk holds paused-session
checkpoints and agent workspaces; it is kept too, but it is lifecycle state, not
backup state.

`helm uninstall` removes the pods and Services and leaves every disk in place.
`helm install` with the same release name adopts them and the data is back. To
delete data, delete the claims yourself.

Upgrading is `helm upgrade` to the new chart version; the chart version is the
Stigmer version, and the images move with it. The pod is recreated, not rolled
(it owns disks that can only be attached to one node), so there is a short
interruption; in-flight agent turns resume from their Temporal checkpoints.

Restoring a Compose stack's data here: the database dumps and restores as usual;
copy the `artifacts` volume's contents into the `<release>-artifacts` disk
(mounted at `/artifacts`, not Compose's `/data/.stigmer/data/artifacts`, because
a mount nested inside another disk is created root-owned on Kubernetes and the
non-root server could not write to it) and the `server-data` volume into
`<release>-server-data`.

## One trust domain

From the Compose file's header, which is the canonical statement: stdio MCP
servers spawn **inside** the runner container; they can reach that container's
filesystem and network, not your nodes'. Treat the pod as one trust domain. The
chart adds no NetworkPolicy; add one at the namespace if your cluster's posture
wants it.

## What the server calls out to

The server refreshes its model registry from `https://api.stigmer.ai` (turn it
off with `STIGMER_MODEL_REGISTRY_REFRESH=off` through `server.extraEnv`); the
runner calls your LLM provider. Nothing else leaves the cluster unless an
agent's tools do.

## Values

Every key is documented in [`values.yaml`](values.yaml) with its reason; this is
the map.

| Key                                               | What it is                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullnameOverride`                                | The name every Service takes; defaults to the release name.                                                                                                                 |
| `image`                                           | Registry, the two repositories (`stigmer-server`, `stigmer-runner`), tags (empty means this chart's version), pull policy, pull Secrets.                                    |
| `secrets`                                         | `existingSecret`, required: `STIGMER_ENCRYPTION_KEY`, `STIGMER_RUNNER_TOKEN_KEY`, and `POSTGRES_PASSWORD` when Postgres is bundled; optional: `STIGMER_PLATFORM_TOKEN_KEY`. |
| `server`                                          | `publicUrl`, `artifactPublicUrl`, `operator.{email,name}`, `oidc.{issuer,audience,consoleClientId}`, `resources`, `persistence`, `securityContext`, `extraEnv`.             |
| `runner`                                          | `llm.existingSecret`, `stigmerToken.{existingSecret,key}`, `resources`, `persistence`, `securityContext`, `extraEnv`.                                                       |
| `artifacts`                                       | `persistence` for the shared artifact disk.                                                                                                                                 |
| `terminationGracePeriodSeconds`                   | How long a stopping pod may drain (60 s; the runner finishes in-flight activities).                                                                                         |
| `waitForDependencies`                             | The init container that waits for Postgres and Temporal (`enabled`, `image`).                                                                                               |
| `postgres`                                        | The bundled Postgres: `enabled`, `image`, `persistence`, `resources`.                                                                                                       |
| `externalDatabase`                                | `host`, `port`, `user`, `database`, `existingSecret`, `passwordKey` when Postgres is yours.                                                                                 |
| `temporal`                                        | The bundled Temporal: `enabled`, `image`, `resources`.                                                                                                                      |
| `externalTemporal`                                | `hostPort`, `namespace` when Temporal is yours.                                                                                                                             |
| `service`                                         | `type` (ClusterIP).                                                                                                                                                         |
| `ingress`                                         | `enabled`, `className`, `api.{host,annotations,tlsSecretName}`, `artifacts.{host,annotations,tlsSecretName}`.                                                               |
| `openfga`, `redis`, `openbao`, `licenseKeySecret` | Reserved for Stigmer Enterprise; refused in this version.                                                                                                                   |

Unknown keys are refused at install, so a typo fails loudly instead of doing
nothing. Anything the chart does not model goes through `server.extraEnv` and
`runner.extraEnv` as plain Kubernetes `env` entries.

## What is deliberately not here

- **Replicas.** The server keeps its skill store on its own disk; one replica is
  a fact, not a setting.
- **A per-session sandbox runner.** Open source's Kubernetes sandbox driver
  hands a per-session runner no way to read artifacts yet
  ([stigmer#1099](https://github.com/stigmer/stigmer/issues/1099)); the values
  arrive with the fix. One shared runner serves the team, as in Compose.
- **A NetworkPolicy, an autoscaler, TLS inside the pod, `helm test` hooks.** See
  the tail of `values.yaml` for why each.
