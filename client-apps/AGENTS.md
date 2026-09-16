# Agent guide: client-apps

The three first-party clients: `cli` (the `stigmer` command, commander plus the
Ink session view from `sdk/ink`), `web` (the Next.js console) and `desktop`
(Tauri, Vite and React Router). The web console and the desktop app are thin
shells over `@stigmer/react`; the CLI is a thin shell over `@stigmer/sdk`.
Anything a platform builder could need belongs in `sdk/`, whose guide binds
there. This guide is an index; the READMEs and headers it names are the truth.

## Read in this order

- `cli/README.md`: the design, the output modes, the development loop;
  `cli/src/program.ts` header for lazy command loading; `cli/src/output/` and
  `cli/src/errors/` headers for the human-output and error contracts.
- `web/README.md` for the stack and build modes; `web/src/domain/` and
  `web/src/app/` for how the console is laid out today.
- `desktop/src/App.tsx` and `desktop/src/shell/`: the provider stack and the
  app-shell frame the desktop owns; `desktop/src-tauri/` for the Rust host.
- `web/eslint.config.mjs`, `desktop/eslint.config.mjs` and
  `tools/eslint-plugin-stigmer/rules/`: the boundaries and token rules the
  linter enforces.
- `.agents/ARCHITECTURE_PRINCIPLES.md`: SDK-first and cross-surface parity.

## Laws, the CLI

- `stdout` carries data only; `stderr` carries status, hints, prompts and
  errors. `-o json` (and `yaml`, `ndjson`) is clean output on stdout with no
  decoration.
- Errors are translated, never leaked: what happened, why, what to do, through
  the one exit point in `cli/src/errors/handle.ts`; exit codes follow
  `cli/src/errors/exit-codes.ts` so scripts branch on `$?`. Raw stacks appear
  only in debug mode.
- Off a TTY there are no colours, spinners or prompts: colour honours the stream
  and `NO_COLOR`, a destructive command auto-confirms under `--force` or a
  non-interactive stderr and never hangs, and a headless run resolves each
  approval by `--approve-default` (skip when unset), never by waiting on a
  prompt.
- An approval prompt is unmissable, keyboard-driven, and never times out into
  approval.
- Destructive commands confirm on a TTY; `--force` is the only bypass.
- Long operations show progress; the CLI never looks crashed.
- Heavy modules load lazily inside the action so `--help`, `version` and
  `completion` stay fast.
- The CLI is verb-first: a resource kind is an argument to a verb (`push skill`,
  `get agent`, `validate -f`), never a noun group of its own. Noun groups exist
  only for account and infrastructure nouns (`auth`, `apikey`, `config`,
  `execution`).

## Laws, web and desktop

- Thin shells: routes, layout and framework wiring only. A page file that grows
  domain logic is logic that belongs in `@stigmer/react`.
- Client-app parity: every consumer of a shared SDK component wires it the same
  way, and a fix to one client's wiring is applied to every client in the same
  changeset. Divergence without a platform reason is a defect.
- Code is grouped by domain (`web/src/domain/`, `desktop/src/pages/`), never by
  technical role.
- Console chrome (`WorkspaceSidebar`, `SettingsSidebar`) is an SDK component
  extended through its seams; never re-transcribe it into a client or a demo.
- The web console's Turbopack loader (`web/turbopack-js-to-ts-loader.js`) strips
  the `.js` the SDK's specifiers carry; when Next.js or Turbopack changes,
  confirm it still covers `from`, dynamic `import(` and side-effect forms.

## Laws, every surface

- Error messages are the interface, on every surface: what happened, why, what
  to do.
- The same word for the same thing and the same confirmation for the same
  destructive act across CLI, console, desktop and SDK.

## Verify

The root map's rows for `cli`, `web` and `desktop`, plus `make gen-cli-docs`
when a command or flag changes so `docs/cli/commands/` stays generated, and a
run of the desktop's Rust checks (`cargo fmt --check`, `cargo clippy`,
`cargo test` in `desktop/src-tauri`) when the host changes.
