# stigmer-server

**What this directory is**: the control plane of the Stigmer OSS edition —
the server `stigmer up` launches. A single-tenant TypeScript service serving
the unified one-port gRPC/gRPC-Web/Connect transport over a `node:sqlite`
store, with Temporal workers for the execution engine.

**Where it came from**: born as `stigmer-server-ts`, a domain-by-domain
TypeScript port of the original Go server, built behind the cross-edition
conformance suite in [`test/conformance/`](../../../test/conformance) and cut
over once its roster equalled the Go server's whole gate. The Go server
retired shortly after (go-server-retirement; its source lives in git
history). Ported modules cite the Go packages they came from — those
citations are the port's provenance record.

## Contract promise

The wire contract is shared: the cloud Java service, the runner, every
published SDK, and databases written before the cutover all speak it.
Byte-pinned identifiers, error copy, and streaming behavior are contract —
every deliberate exception is recorded in the program's parity-deltas
register, and nothing diverges silently. The conformance suite
(`test/conformance/`, targets `local` and `local-execution`) is the gate for
every change that lands here.

## Docker image

The official image `ghcr.io/stigmer/stigmer-server` packages the same `@stigmer/server-slim` artifact the CLI acquires — unified port, bundled web console, sqlite by default — for linux/amd64 and linux/arm64. `stigmer up` remains the front door for laptops; the image is the alternative when you want the server contained or on a machine without the CLI:

```bash
docker run -d --name stigmer-server \
  -p 7234:7234 -p 7235:7235 \
  -v stigmer-data:/data \
  ghcr.io/stigmer/stigmer-server:latest
```

The console is on `http://localhost:7234`, the API on the same port (gRPC, gRPC-Web, Connect, REST), and artifact downloads on 7235. `/data` holds ALL state — the database, skill storage, artifacts, and the auto-generated encryption keys — in the exact layout of a bare-metal `~/.stigmer`, so the volume is the complete backup and is portable to and from a `stigmer up` install. Losing the volume loses the encryption keys with it, which makes every encrypted value in a copied database unrecoverable — treat the volume as the unit of backup. With a bind mount instead of a named volume, `chown 1000` the host directory first (the server runs as the non-root `node` user). Set `DATABASE_URL` to run against Postgres instead of sqlite; point `TEMPORAL_HOST_PORT` at a reachable Temporal for the execution engine (the server serves without one — executions wait until it connects; the docker-compose stack that wires all of this arrives with the self-host tier).

Tags: one per release (`vX.Y.Z`); `latest` moves only to stable releases, and only after the pushed image has boot-smoked on native runners of both architectures (`release.npm-libs.yaml`). Local build + smoke: `make smoke-docker-image`.

## Development

Standalone package (own lockfile, not an npm workspace — the runner's model):

```bash
npm install          # after: npm run build -w @stigmer/protos (repo root)
npm run typecheck
npm test
npm run build && npm run verify:dist    # compiled entry, booted with plain node
npm run build:slim && npm run verify:slim
```

Or from the repo root: `make build-server`, `make test-server`.

Coding standards for this service live in
`.cursor/rules/backend/ts-server-guidelines.mdc`.
