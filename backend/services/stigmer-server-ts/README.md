# stigmer-server-ts

**What this directory is**: a TypeScript port of
[`stigmer-server`](../stigmer-server) (the Go control plane of the Stigmer
OSS edition), built domain by domain behind the cross-edition conformance
suite in [`test/conformance/`](../../../test/conformance).

**What it is not (yet)**: the served implementation. The Go server remains
the server that `stigmer up` launches. Nothing changes for users while this
port is in progress, and the switch will only happen once the full
conformance roster — the same suites that gate the Go server today — passes
against this implementation.

**Why**: one backend language across the OSS server and the runner,
supported-by-construction platforms (linux-arm64, Windows), and no
first-run binary download. A full write-up ships with the cutover release.

## Parity promise

Behind the CLI, users must not be able to tell the two servers apart: same
port and env contract, same database file, same error copy, same streaming
behavior. Every deliberate exception is recorded in the project's
parity-deltas register — nothing diverges silently. The conformance suite
(`test/conformance/`, `CONFORMANCE_TARGET=local-ts` as the roster grows) is
the gate for every domain that lands here.

## Development

Standalone package (own lockfile, not an npm workspace — the runner's
model):

```bash
npm install          # after: npm run build -w @stigmer/protos (repo root)
npm run typecheck
npm test
npm run build && npm run verify:dist    # compiled entry, booted with plain node
npm run build:slim && npm run verify:slim
```

Or from the repo root: `make build-server-ts`, `make test-server-ts`.

Coding standards for this service live in
`.cursor/rules/backend/ts-server-guidelines.mdc`.
