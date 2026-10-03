# @stigmer/cli

The Stigmer command-line interface — manage agents, workflows, MCP servers,
skills, and executions from the terminal.

This is the TypeScript CLI that replaced the Go CLI. Its shape, in brief:

- the commander command tree (`stigmer ...`);
- cross-cutting infrastructure: config, errors/exit-codes, unified output, the
  backend client façade, the resource-type registry, and PKCE auth with
  refresh-token support;
- reads and writes: `get`, `list`, `validate`, `apply`, `delete`, `diff`, plus
  `version` and `completion`;
- streaming runs (`run`, `resume`) rendered with in-process Ink;
- local orchestration (`up`, `down`, `status`, `logs`);
- the plugin, skill and sharing commands (`install`, `push`, `marketplace`,
  `share`) and the rest of the tree `stigmer --help` lists.

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
and the in-process Ink session view. The backend-client façade
also exposes the underlying transport so write flows can use raw controllers for
full YAML-to-proto fidelity.

Output is unified on `-o/--output {table,json,yaml,ndjson}`; `--json`/`--quiet`
are back-compat aliases that resolve per command class. Structured command output
goes to stdout; human status, hints, and errors go to stderr.

The binding laws for this package are in [`../AGENTS.md`](../AGENTS.md) (the
client-apps guide) and the root `AGENTS.md`: single-responsibility files, thin
command handlers, and comments that explain *why*.
