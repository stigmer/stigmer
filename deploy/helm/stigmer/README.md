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
  server) and the **runner** (executes agents, holds your LLM
  key). They share the pod network and an artifact disk, the way `stigmer up`
  shares one laptop and Compose shares one host.
- **Postgres**, bundled as one `postgres:16.15` instance with one disk (one
  team's posture), or yours through `externalDatabase`.
- **Temporal**, bundled as one `temporalio/auto-setup` pod, or yours through
  `externalTemporal`. For production Temporal,
  [Temporal's own chart](https://github.com/temporalio/helm-charts) is the path.
- **Your keys, explicitly.** The chart refuses to install until you name a
  Secret with the two server keys (and the database password when Postgres is
  bundled). The server never generates keys into a disk you did not know about.
- **State that survives `helm uninstall`.** Every disk the chart creates is
  kept; a later install of the same release name adopts it.
- **Safe by default.** Every bundled container runs as a non-root user with no
  privilege to escalate and every capability dropped, but the runner. It runs
  as root with five capabilities, so it can start the agents' side as a user
  of its own that cannot read the runner's keys. The bundled Postgres and
  Temporal admit only the pods that use them. An install reachable from outside
  the cluster is refused while sign-in is off.
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

Without authentication, every caller that can reach the port has full control.
Without an Ingress the Service is a ClusterIP: reachable from outside the
cluster only through that port-forward, but from every pod inside it. That is
the laptop posture, and fine for trying it. For a team, add an Ingress and turn
authentication on together (below): the chart refuses an Ingress, a `NodePort`
or `LoadBalancer` Service, or a public URL other than `localhost` while
authentication is off.

Give the runner an LLM key so agents can run:

```bash
kubectl -n stigmer create secret generic stigmer-llm-keys --from-literal=ANTHROPIC_API_KEY=sk-ant-...
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reset-then-reuse-values \
  --set runner.llm.existingSecret=stigmer-llm-keys
```

## Reach it from outside the cluster

Set `ingress.enabled` and two hostnames: one for the API and console, one for
artifact downloads. The two are separate because the artifact lane is its own
listener whose storage keys carry full paths, so it cannot share a host by path
prefix.

Turn authentication on in the same step. Without it, every caller is the
operator with full control, so anyone who finds the address would control
Stigmer, and the chart refuses to install it (see
[Authentication](#authentication) for the issuer and the runner's key):

```yaml
server:
  oidc:
    issuer: https://your-issuer.example.com
    audience: https://stigmer.example.com
    consoleClientId: stigmer-console
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
`server.artifactPublicUrl` yourself if you front the Service another way; a URL
naming a host other than `localhost`, `127.0.0.1` or `[::1]` counts as exposure
too. The download links the server mints are signed and expire, at most seven
days after they are minted, so a link left in a chat or a log stops working.

If something of yours already authenticates every caller before Stigmer (an
authenticating proxy in front, a private network), set
`server.allowUnauthenticatedExposure: true` to say the exposure is on purpose.
It does not make the install safe, and the install notes repeat that every time.

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

With authentication on, the runner needs an API key to call the server. The key
is the runner's own credential (it fetches its configuration and the model
registry with it); it does not decide whose runs the runner may serve or who is
recorded as running them. For each run the server hands the runner a credential
for that run alone, so every member's run executes and is attributed to the
member who started it, whoever's key the runner process holds. Only someone
signed in can create a key, so an authenticated install is two steps, and
sign-in comes first:

1. Set the issuer: below as an upgrade of a running install, or the same three
   values in a first install, with the Ingress if you add one. The issuer is an
   `https` URL. The pod runs the server alone, and the install notes say the
   runner is waiting for its key:

```bash
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reset-then-reuse-values \
  --set server.oidc.issuer=https://your-issuer.example.com \
  --set server.oidc.audience=https://stigmer.example.com \
  --set server.oidc.consoleClientId=stigmer-console
```

2. Sign in, create the runner's key with no expiry (Settings → API Keys, or
   `stigmer apikey create --name runner --never-expires`), put it in a Secret
   and upgrade with its name. The runner starts:

```bash
kubectl -n stigmer create secret generic stigmer-runner-token --from-literal=STIGMER_TOKEN=stk_...
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reset-then-reuse-values \
  --set runner.stigmerToken.existingSecret=stigmer-runner-token
```

A key created while the server still trusted every caller is refused once
authentication is on, with a message saying so. Create keys after you sign in.

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

A Temporal that requires TLS, mutual TLS or an API key (Temporal Cloud, or a
frontend with an authorizer) takes its credentials from Secrets:

```yaml
externalTemporal:
  hostPort: my-namespace.a1b2c.tmprl.cloud:7233
  namespace: my-namespace.a1b2c
  tls:
    enabled: true
    existingSecret: temporal-tls # PEM items by key; each key optional
    caKey: ca.crt # the frontend's CA; omit for publicly trusted roots
    certKey: tls.crt # mutual TLS: the client certificate and its key
    keyKey: tls.key
  apiKey:
    existingSecret: temporal-api-key # key STIGMER_TEMPORAL_API_KEY
```

Both containers receive them as the `STIGMER_TEMPORAL_*` settings, by
`secretKeyRef`, never as a mount. The runner moves the API key and the client
key out of its environment at boot, and its agent tools run as the agent user,
which cannot read the runner's process or files, so they cannot read them. They
are Stigmer's own names, so a developer's `TEMPORAL_API_KEY` for their own
Temporal work is never picked up.

The server's `DATABASE_URL` names the user, host and port. The database reaches
the server as `PGDATABASE` and the password as `PGPASSWORD` from its Secret, so
the password never appears in rendered manifests and no character in either can
break the URL. Connection options the Postgres client reads from the
environment, such as `PGSSLMODE=require` for a managed database, go through
`server.extraEnv`. When Temporal stays bundled and Postgres is yours, Temporal's
`auto-setup` creates its two databases (`temporal`, `temporal_visibility`) on
your instance at first boot and needs a user with `CREATE DATABASE`.

## Backup, restore, upgrade

A complete backup is four things: the database (the bundled Postgres's disk, or
yours), the `<release>-artifacts` disk, the `<release>-server-data` disk, and
the Secret you created. The bundled Postgres admits only the stigmer and
Temporal pods (`postgres.networkPolicy`), so a backup job that dumps it from a
pod of its own needs a NetworkPolicy of yours that admits it; policies add up,
so yours and the chart's both apply. The `<release>-runner-data` disk holds
paused-session checkpoints and agent workspaces; it is kept too, but it is
lifecycle state, not backup state.

`helm uninstall` removes the pods and Services and leaves every disk in place.
`helm install` with the same release name adopts them and the data is back. To
delete data, delete the claims yourself.

Upgrading is `helm upgrade` to the new chart version; the chart version is the
Stigmer version, and the images move with it. An upgrade with `--reuse-values`
keeps every value of the release, defaults included, so it does not pick up a
new chart's new defaults (an image tag, a security context), and an upgrade
that names no `--version` takes the newest chart. Use
`--reset-then-reuse-values` (Helm 3.14 and later) to take the chart's defaults
with your own values on top; the upgrades in this README do. The upgrade the
install notes print names the installed chart's `--version`, so its
`--reuse-values` keeps the values with the chart they were written for. The pod is recreated, not rolled (it owns disks that can only be
attached to one node), so there is a short interruption; in-flight agent turns
resume from their Temporal checkpoints.

Restoring a Compose stack's data here: the database dumps and restores as usual;
copy the `artifacts` volume's contents into the `<release>-artifacts` disk
(mounted at `/artifacts`, not Compose's `/data/.stigmer/data/artifacts`, because
a mount nested inside another disk is created root-owned on Kubernetes and the
non-root server could not write to it) and the `server-data` volume into
`<release>-server-data`.

## One trust domain

From the Compose file's header, which is the canonical statement: stdio MCP
servers spawn **inside** the runner container; they can reach that container's
filesystem and network, not your nodes'. That network includes the cluster's
Services. Treat the pod as one trust domain.

Inside it, the runner keeps its keys out of the agents' reach. It runs as root
and starts everything an agent runs (the engines, their commands, MCP servers
and hooks) as `stigmer-agent`, uid 10001, through `setpriv`, keeping only
`SETUID`, `SETGID`, `CHOWN`, `KILL` and `DAC_OVERRIDE` (`runner.securityContext`). That user cannot read
the runner's process, its state or its keys, and the runner makes every model
call for it. The agent's home is `/data/agent` on the runner's volume.
Agents install user-level packages; bake system packages into your own runner
image.

Temporal belongs to that domain. Whoever reaches its frontend can start work on
the runner's queue. The runner only runs the workflow types the server starts,
and it reads each run's work back from the server. The bundled Temporal
authenticates nothing, so the chart fences it with a NetworkPolicy
(`temporal.networkPolicy`). Only the stigmer pod may connect, and a network
plugin that ignores NetworkPolicy leaves it open. The runner's own tools share
the stigmer pod and so sit inside the fence. For a Temporal outside that
boundary, use your own with authentication on (`externalTemporal.tls`,
`externalTemporal.apiKey`).

The bundled Postgres holds everything Stigmer keeps and authenticates by
password alone, so the chart fences it the same way (`postgres.networkPolicy`):
the stigmer pod and the Temporal pod may connect, nothing else.

The bundled Postgres and Temporal run as their images' own non-root users. A
fresh Postgres disk is made writable through the pod's `fsGroup`; storage that
ignores `fsGroup` (a `hostPath` volume, or a CSI driver whose `fsGroupPolicy` is
`None`) leaves the disk's root owned by root, and Postgres cannot create its
data directory. Set `postgres.securityContext: null` there to start it as its
image does, or set the context your cluster assigns (OpenShift). The chart adds
no NetworkPolicy for the stigmer pod itself; add one at the namespace if your
cluster's posture wants it.

## What the server calls out to

The server refreshes its model registry from `https://api.stigmer.ai` (turn it
off with `STIGMER_MODEL_REGISTRY_REFRESH=off` through `server.extraEnv`); the
runner calls your LLM provider. Nothing else leaves the cluster unless an
agent's tools do.

## Values

Every key is documented in [`values.yaml`](values.yaml) with its reason; this is
the map.

| Key                                               | What it is                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullnameOverride`                                | The name every Service takes; defaults to the release name.                                                                                                                                     |
| `image`                                           | Registry, the two repositories (`stigmer-server`, `stigmer-runner`), tags (empty means this chart's version), pull policy, pull Secrets.                                                        |
| `secrets`                                         | `existingSecret`, required: `STIGMER_ENCRYPTION_KEY`, `STIGMER_RUNNER_TOKEN_KEY`, and `POSTGRES_PASSWORD` when Postgres is bundled; optional: `STIGMER_PLATFORM_TOKEN_KEY`.                     |
| `server`                                          | `publicUrl`, `artifactPublicUrl`, `allowUnauthenticatedExposure`, `operator.{email,name}`, `oidc.{issuer,audience,consoleClientId}`, `resources`, `persistence`, `securityContext`, `extraEnv`. |
| `runner`                                          | `llm.existingSecret`, `stigmerToken.{existingSecret,key}`, `resources`, `persistence`, `securityContext`, `extraEnv`.                                                                           |
| `artifacts`                                       | `persistence` for the shared artifact disk.                                                                                                                                                     |
| `terminationGracePeriodSeconds`                   | How long a stopping pod may drain (60 s; the runner finishes in-flight activities).                                                                                                             |
| `waitForDependencies`                             | The init containers that wait for Postgres and Temporal (`enabled`, `image`, `securityContext`).                                                                                                |
| `postgres`                                        | The bundled Postgres: `enabled`, `image`, `persistence`, `resources`, `securityContext`, `networkPolicy.enabled` (the fence to the stigmer and Temporal pods, on by default).                   |
| `externalDatabase`                                | `host`, `port`, `user`, `database`, `existingSecret`, `passwordKey` when Postgres is yours.                                                                                                     |
| `temporal`                                        | The bundled Temporal: `enabled`, `image`, `resources`, `securityContext`, `networkPolicy.enabled` (the fence to the stigmer pod, on by default).                                                |
| `externalTemporal`                                | `hostPort`, `namespace` when Temporal is yours; `tls.{enabled,serverName,existingSecret,caKey,certKey,keyKey}` and `apiKey.{existingSecret,key}` when it authenticates.                         |
| `service`                                         | `type` (ClusterIP).                                                                                                                                                                             |
| `ingress`                                         | `enabled`, `className`, `api.{host,annotations,tlsSecretName}`, `artifacts.{host,annotations,tlsSecretName}`.                                                                                   |
| `openfga`, `redis`, `openbao`, `licenseKeySecret` | Reserved for Stigmer Enterprise; refused in this version.                                                                                                                                       |

Unknown keys are refused at install, so a typo fails loudly instead of doing
nothing; every `securityContext` takes the Kubernetes container fields and no
other. Anything the chart does not model goes through `server.extraEnv` and
`runner.extraEnv` as plain Kubernetes `env` entries. A name the chart sets
itself is refused there, because Kubernetes keeps the last entry of a name and
the extra one would silently replace the chart's.

## What is deliberately not here

- **Replicas.** The server keeps its skill store on its own disk; one replica is
  a fact, not a setting.
- **A per-session sandbox runner.** Open source's Kubernetes sandbox driver,
  `agent-sandbox`, hands a per-session runner no way to read artifacts yet
  ([stigmer#1099](https://github.com/stigmer/stigmer/issues/1099)); the values
  arrive with the fix. One shared runner serves the team, as in Compose.
- **A NetworkPolicy for the stigmer pod, an autoscaler, TLS inside the pod,
  `helm test` hooks.** See the tail of `values.yaml` for why each.
