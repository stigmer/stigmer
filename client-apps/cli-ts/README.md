# @stigmer/cli

The Stigmer command-line interface — manage agents, workflows, MCP servers,
skills, and executions from the terminal.

This is the TypeScript successor to the Go CLI (`client-apps/cli/`). It is being
built in waves; this package currently covers the **Wave 1 foundation**:

- Package scaffold + commander command tree (`stigmer ...`)
- Cross-cutting infrastructure: config, errors/exit-codes, unified output, the
  backend client façade, the resource-type registry, and PKCE auth with
  refresh-token support
- Read verbs: `get`, `list`, `validate`, plus `version` and `completion`

Resource mutation (`apply`/`delete`/...), streaming (`run`/`resume`) with
in-process Ink, and local orchestration (`up`/`down`) land in later waves.

## Development

```bash
make help        # list targets
make typecheck   # tsc --noEmit
make build       # tsc -p tsconfig.build.json -> dist/
make test        # vitest run
npm run start -- --help   # run the CLI from source via tsx
```

## Design

The CLI standardizes on the high-level `@stigmer/sdk` `Stigmer` client for reads
and (in a later wave) the in-process Ink session view. The backend-client façade
also exposes the underlying transport so write flows can use raw controllers for
full YAML-to-proto fidelity.

Output is unified on `-o/--output {table,json,yaml,ndjson}`; `--json`/`--quiet`
are back-compat aliases that resolve per command class. Structured command output
goes to stdout; human status, hints, and errors go to stderr.

Code follows the Stigmer CLI engineering standards
(`.cursor/rules/client-apps/cli/coding-guidelines.mdc`) and the agent commenting
standard: single-responsibility files, thin command handlers, and comments that
explain *why*.
