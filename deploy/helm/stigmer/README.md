# Stigmer on Kubernetes

[Stigmer](https://stigmer.ai), the open-source backend for the agents in your
product, as a Helm chart: the server with the web console, the runner, and
Postgres and Temporal bundled or yours. It is the
[Docker Compose stack](../../../docker-compose.yml) translated. The same four
parts run, the same environment variables are set (a test holds the two equal,
name for name), the same keys are yours to supply, and the same things make up a
backup.

Free, Apache 2.0, one organization. Stigmer Enterprise runs from this same
chart with more values: a license Secret switches the server to the Enterprise
image (see [Stigmer Enterprise](#stigmer-enterprise)).

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
  the cluster is refused while sign-in is off. The stigmer pod's outbound
  network can be fenced to the public internet (`egressPolicy`), and is by
  default under an Enterprise license.
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
the short-lived user tokens a service account's API key mints once authentication is on
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

## Stigmer Enterprise

Stigmer Enterprise is the same server with a license key: many organizations,
teams, invitations, federation with other identity providers, and the access
history. It runs from this chart. Name a Secret holding the key, and the server
container runs `ghcr.io/stigmer/stigmer-server-ee` at the same tag as the
open-source image would (`image.server.enterpriseRepository`, for a mirror),
with the key and its settings:

```bash
kubectl -n stigmer create secret generic stigmer-license \
  --from-literal=STIGMER_LICENSE_KEY=<the key you were sent>
helm install stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer \
  --set secrets.existingSecret=stigmer-secrets \
  --set server.oidc.issuer=https://your-issuer.example.com \
  --set server.oidc.audience=https://stigmer.example.com \
  --set server.oidc.consoleClientId=stigmer-console \
  --set enterprise.license.existingSecret=stigmer-license
```

A licensed server signs every caller in, so `server.oidc` is required with the
license; the chart refuses one without the other, as the server would at boot.
That brings [Authentication](#authentication)'s second step: the pod runs the
server alone until you sign in, create the runner's key and upgrade with its
Secret.

**No release trusts a production signing key yet.** Until one does, every key
stops the server container with one `boot failed:` line saying why
(`kubectl -n stigmer logs deploy/stigmer -c server`), and the pod never becomes
ready. Without a key the Enterprise image is the open-source server exactly; for
a trial on one machine, `docker run` the image as
[its README](../../../ee/server/README.md) says.

The settings, under `enterprise` (their meanings are the server's, in
[`ee/server/README.md`](../../../ee/server/README.md)):

| Value                                   | Server setting                          | Default                                 |
| --------------------------------------- | --------------------------------------- | --------------------------------------- |
| `enterprise.license.existingSecret`     | `STIGMER_LICENSE_KEY` (by reference)    | empty: open source                      |
| `enterprise.license.key`                | the key's name in that Secret           | `STIGMER_LICENSE_KEY`                   |
| `enterprise.organizationCreators`       | `STIGMER_ORGANIZATION_CREATORS`         | empty: anyone signed in                 |
| `enterprise.accessHistoryRetentionDays` | `STIGMER_ACCESS_HISTORY_RETENTION_DAYS` | null: every entry kept                  |
| `enterprise.outboundEgress`             | `STIGMER_OUTBOUND_EGRESS`               | `strict`, which also turns the fence on |

Each setting without a license is refused: the open-source server never reads
it. They are set here, not through `server.extraEnv`, which refuses those names
in every edition.

**The outbound fence.** Under a license anyone who signs in can found an
organization and run an agent, and everything an agent runs leaves from the
stigmer pod. So with `outboundEgress: strict` the chart fences the pod's
outbound network (`egressPolicy`, below): it reaches DNS, the bundled Postgres
and Temporal, every public address, and the CIDRs in `egressPolicy.allowedCidrs`;
no other private address. An agent's `curl http://10.0.3.7/admin` times out
while its call to the model provider goes through. The server's own guard on
URLs people write refuses private addresses too, so strict is one promise kept
at two layers. An identity provider, a model endpoint, or your own Postgres or
Temporal on a private address needs its CIDR in `egressPolicy.allowedCidrs`;
the install notes name the dependencies that need it. `relaxed` lets the server
reach private addresses and renders no fence unless you set
`egressPolicy.enabled`.

**The dependencies stay fenced.** Under a license the chart refuses
`postgres.networkPolicy.enabled=false` and `temporal.networkPolicy.enabled=false`
while that dependency is bundled, and an external Temporal with neither
`externalTemporal.tls.enabled` nor `externalTemporal.apiKey`: a licensed install
is shared by many organizations, and a plaintext Temporal lets whoever reaches it
start work on the runner's queue.

**What it calls out to.** The same as open source
([below](#what-the-server-calls-out-to)): the model registry refresh, a GET of a
public document carrying no customer data. A license never calls home: the key
is verified inside the server. Turn the refresh off for an install with no
internet.

**When a license lapses**, everything keeps working and only growth is refused
(a new organization, team or federation issuer) until you renew. Renew by
updating the Secret and restarting the pod
(`kubectl -n stigmer rollout restart deploy/stigmer`). Renew a key; never
remove it from a licensed install, which is not a supported path back.

**Moving an open-source install to Enterprise** is one upgrade on the same
disks and database, once sign-in is on: the organization, its people, their
roles and everything they made stay, and that organization counts toward the
license's organization limit.

```bash
helm upgrade stigmer oci://ghcr.io/stigmer/charts/stigmer -n stigmer --reset-then-reuse-values \
  --set enterprise.license.existingSecret=stigmer-license
```

There is no Enterprise Compose file: a licensed server needs Postgres and an
outside identity provider, which Compose's quick start has neither of.

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
filesystem and network, not your nodes'. Treat the pod as one trust domain.

That network includes the cluster's Services, unless the pod is fenced. With
`egressPolicy.enabled` (or an Enterprise license, whose strict default turns it
on) the chart adds a NetworkPolicy on the stigmer pod's outbound connections:
DNS on port 53 to any address (cluster DNS sits on a private address,
NodeLocal DNSCache on a link-local one), the bundled Postgres and Temporal on
their ports, every public address, and `egressPolicy.allowedCidrs`. The
private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
`fc00::/7`), shared address space (`100.64.0.0/10`), link-local (which holds
cloud metadata) and loopback are refused. The runner's fetch tool refuses
private addresses too, with a sentence rather than a timeout. What the fence
does not hold:

- **Inside the pod.** The server, the runner and everything an agent runs still
  share one filesystem boundary per container and one network; the fence is
  around the pod.
- **The pod's own node.** Kubernetes always allows a pod's traffic to the node
  it runs on, so a service listening on the node itself (the kubelet; on some
  clouds a metadata server) is outside the fence. Use your cloud's controls for
  those (a metadata hop limit, workload identity).
- **A network plugin that ignores NetworkPolicy.** It leaves the pod open, as it
  leaves the dependencies' fences.
- **Host names.** NetworkPolicy takes addresses, so an external database or
  issuer on a private address goes into `allowedCidrs` by CIDR. A distribution
  whose DNS pods listen on a port other than 53 (OpenShift's DNS listens on
  5353) lists their CIDR there too.

The fence holds the pod's outbound connections only. What reaches its ports is
the API, which authenticates every caller once sign-in is on.

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
image does, or set the context your cluster assigns (OpenShift).

## What the server calls out to

The server refreshes its model registry from `https://api.stigmer.ai`, a GET of
a public document with no customer data in it (turn it off with
`STIGMER_MODEL_REGISTRY_REFRESH=off` through `server.extraEnv`, for an install
with no internet); the runner calls your LLM provider. Nothing else leaves the
cluster unless an agent's tools do. With the outbound fence on, those tools
reach the public internet and `egressPolicy.allowedCidrs`, and none of the
cluster's private addresses.

## Values

Every key is documented in [`values.yaml`](values.yaml) with its reason; this is
the map.

| Key                                               | What it is                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullnameOverride`                                | The name every Service takes; defaults to the release name.                                                                                                                                     |
| `image`                                           | Registry, repositories (`stigmer-server`, `stigmer-runner`; `server.enterpriseRepository`, run under a license), tags (empty means this chart's version), pull policy, pull Secrets.            |
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
| `enterprise`                                      | `license.{existingSecret,key}` (the switch), `organizationCreators`, `accessHistoryRetentionDays`, `outboundEgress`; see [Stigmer Enterprise](#stigmer-enterprise).                             |
| `egressPolicy`                                    | `enabled`, `allowedCidrs`: the stigmer pod's outbound fence, on by default under a strict license; see [One trust domain](#one-trust-domain).                                                   |
| `openfga`, `redis`, `openbao`, `licenseKeySecret` | Retired: reserved before Stigmer Enterprise shipped, which needs none. Accepted at their off values; refused when turned on.                                                                    |

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
- **A NetworkPolicy admitting connections into the stigmer pod, an autoscaler,
  TLS inside the pod, `helm test` hooks.** See the tail of `values.yaml` for
  why each.
