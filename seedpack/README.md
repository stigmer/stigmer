# @stigmer/seedpack

The embedded **system seedpack** for the Stigmer platform — the built-in agents,
skills, MCP server definitions, and workflows (under the `stigmer` organization)
that are bootstrapped into every Stigmer backend.

The seedpack is a standard Stigmer project: a `stigmer.yaml` plus vendored
resource subtrees. It ships as an npm package so the lean `@stigmer/cli` can
acquire it on demand (the same pattern as `@stigmer/runner-slim` and the managed
Temporal binary) instead of carrying ~300 content files in every install.

This package contains **no apply logic** — a host resolves the content directory
and runs it through the normal declarative-apply path, so system content and
user projects share one code path.

## API

```ts
import { contentDir, contentHash, extractToDir } from "@stigmer/seedpack";

contentDir(); // absolute path to the content root (holds stigmer.yaml)
contentHash(); // "sha256:<16 hex>" — the bootstrap's idempotency marker, identical on every delivery path
extractToDir("/tmp/seedpack"); // copy a clean project of the canonical entries
```

The canonical content set is `SEEDPACK_ENTRIES` in `src/index.ts`:
`stigmer.yaml`, `organizations/`, `skills/`, `agents/`, `workflows/`,
`mcp-servers/`. Build tooling (`tools/`), UI assets (`icons/`) and the CI canary
manifest (`canary/`) are excluded. The CLI's `SEEDPACK_ENTRIES` and
`scripts/stage-content.mjs` mirror that list.

## Tests

Two suites, split by whether they touch the network (`vitest.config.ts` and
`vitest.transport.config.ts`; the static config excludes the transport directory
by path, so a static run cannot reach the network by construction):

- `npm test` (static; `make test-seedpack-static`, the `ci.seedpack-static`
  lane): the package API, the "every YAML has a `kind`" guard for the
  declarative-apply bootstrap, and the marketplace curation policies over
  `mcp-servers/*.yaml` (`src/__tests__/mcp-catalog.test.ts`). The policies read
  every manifest through the generated `McpServer` schema — the same `fromJson`
  the docs-yaml gate uses — and cover what the contract cannot express: the
  category set, the OAuth header convention, placeholder declarations, the
  canary manifest, `oauth_only`, the retired-endpoint denylist. Structural
  validity against the proto is `make check-docs-yaml`'s job, on every PR.
- `npm run test:transport` (`make test-seedpack-transport`, the nightly
  `ci.seedpack-canary` lane): credential-free live probes of every HTTP endpoint
  in the catalog. Skips on transient network conditions; fails on a vendor 5xx,
  a malformed discovery document, or a non-MCP answer to `initialize`.

Both suites need `@stigmer/protos` built (`npm run build -w @stigmer/protos`);
the `make` targets do that first.
