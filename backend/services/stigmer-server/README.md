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
