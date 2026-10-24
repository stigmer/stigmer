# Format on edit

Runs the project's own formatter on every file the agent writes or edits, right
after the change, and tells the agent which lines moved. A TypeScript project
that uses Prettier gets its files back in Prettier's layout; a Go file gets
`gofmt`; a Python project configured for Ruff gets `ruff format`. The change a
person reviews is already formatted, and the agent's next edit re-reads the
lines the formatter moved instead of quoting text that is no longer there.

## Turn it on

The plugin does nothing until it is listed:

- On an agent: **Add to an agent** on the plugin's page, or in the agent's YAML
  `plugins: [{kind: plugin, slug: format-on-edit}]`. Every conversation with
  that agent formats.
- On one conversation: **Start a chat** on the plugin's page, or
  `stigmer run --plugin format-on-edit`.

It is a Claude Code `PostToolUse` hook on `Write|Edit`, read through
`.claude-plugin/plugin.json`, so Stigmer runs it on both its engines and Claude
Code runs it as is. It needs `node` on the hook's `PATH`, nothing else.

## What it runs

The first formatter in this table whose evidence holds and whose binary is
present, tried in order until one succeeds. Evidence is looked for from the
file's folder up to the workspace root, never above it, and the formatter runs
in the folder its evidence was found in.

| Formatter     | Files                                                            | Runs when                                                                                            |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| gofmt         | `.go`                                                            | `gofmt` is on `PATH`                                                                                 |
| mix format    | `.ex .exs .eex .heex .leex .neex .sface`                         | a `mix.exs`, and `mix` on `PATH`                                                                     |
| oxfmt         | JavaScript and TypeScript                                        | a `package.json` depends on `oxfmt`, binary in `node_modules/.bin`                                   |
| Prettier      | JavaScript, TypeScript, CSS, HTML, JSON, YAML, Markdown and more | a `package.json` depends on `prettier`, binary in `node_modules/.bin`                                |
| Biome         | the same as Prettier                                             | a `biome.json` or `biome.jsonc`, binary in `node_modules/.bin`                                       |
| zig fmt       | `.zig .zon`                                                      | `zig` on `PATH`                                                                                      |
| clang-format  | C and C++                                                        | a `.clang-format`, and `clang-format` on `PATH`                                                      |
| Ruff          | `.py .pyi`                                                       | a `ruff.toml`, `.ruff.toml` or `[tool.ruff]` in `pyproject.toml`; binary in `.venv/bin` or on `PATH` |
| dart format   | `.dart`                                                          | `dart` on `PATH`                                                                                     |
| ocamlformat   | `.ml .mli`                                                       | an `.ocamlformat`, and `ocamlformat` on `PATH`                                                       |
| terraform fmt | `.tf .tfvars`                                                    | `terraform` on `PATH`                                                                                |
| gleam format  | `.gleam`                                                         | `gleam` on `PATH`                                                                                    |
| rustfmt       | `.rs`                                                            | `rustfmt` on `PATH`; `--edition` from the crate's `Cargo.toml`                                       |
| Pint          | `.php`                                                           | a `composer.json` requires `laravel/pint`, binary in `vendor/bin`                                    |

A formatter the project does not declare is never run, even when it is installed
on the machine, because formatting a whole file in a style the project does not
use turns a one-line change into a rewrite. Nothing is downloaded or installed.
Each formatter is stopped after 20 seconds.

## What the agent is told

When the formatter changed the file, one line is added to the tool's result:

```text
Prettier reformatted src/app.ts after this change (lines 12-18 now differ from what you wrote). Read those lines again before quoting them in another edit.
```

Nothing is added when the file was already formatted, when no formatter applies,
or when the edit itself failed. When every formatter that applies fails, the
file stays as the edit left it and the hook's failure is logged with the
formatter's name and exit, never the file's.

## What to know before turning it on

- It runs the project's own code. A formatter in `node_modules`, `.venv` or
  `vendor`, and a formatter's config file that is itself code
  (`prettier.config.js`), run with the agent's environment, after every edit,
  outside the approval of individual tool calls. Listing the plugin is that
  approval, as with any hook. An agent that is not allowed to run commands can,
  with this plugin, still have the project's formatter run.
- It formats the whole file. In a project that keeps its files formatted that is
  the edited lines alone; in one that does not, the first edit to a file
  reformats all of it.
- It formats what the file tools write. A file changed by a shell command is not
  formatted.
