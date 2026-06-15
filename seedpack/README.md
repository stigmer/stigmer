# @stigmer/seedpack

The embedded **system seedpack** for the Stigmer platform — the built-in agents,
skills, MCP server definitions, and workflows (under the `stigmer` organization)
that are bootstrapped into every Stigmer backend.

The seedpack is a standard Stigmer project: a `stigmer.yaml` plus vendored
resource subtrees. It ships as an npm package so the lean `@stigmer/cli` can
acquire it on demand (the same pattern as `@stigmer/runner-slim` and the managed
Temporal binary) instead of carrying ~300 content files in every install.

This package contains **no apply logic** — a host resolves the content directory
and runs it through the normal declarative-apply path, so system content and user
projects share one code path.

## API

```ts
import { contentDir, contentHash, extractToDir } from "@stigmer/seedpack";

contentDir(); // absolute path to the content root (holds stigmer.yaml)
contentHash(); // "sha256:<16 hex>" — stable across the Go and TS delivery paths
extractToDir("/tmp/seedpack"); // copy a clean project of the canonical entries
```

The canonical content set (`SEEDPACK_ENTRIES`) mirrors the `//go:embed` set in
`embed.go`: `stigmer.yaml`, `organizations/`, `skills/`, `agents/`, `workflows/`,
`mcp-servers/`. Build tooling (`tools/`) and UI assets (`icons/`) are excluded.
