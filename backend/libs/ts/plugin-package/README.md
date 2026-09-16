# @stigmer/plugin-package

Reads an Agent Plugins package into one normalised description of what
Stigmer would install from it.

A plugin is a folder with a manifest, `skills/` and an MCP server
configuration. This library reads the open Agent Plugins 1.0.0 format and
the three vendor dialects that preceded it (Cursor `.cursor-plugin/`,
Claude Code `.claude-plugin/`, Codex `.codex-plugin/`) unchanged, and hands
back a `PluginPackage`: the skills, MCP servers, sub-agents and variables in
the shapes Stigmer's resources take, the `ai.stigmer/` overlay documents as
opaque bytes, and every component it ignored. What Stigmer cannot carry is
refused with one fixed sentence per problem, and the reader keeps scanning
past a refusal so one run reports every problem at once.

## Why this is a library

The same code runs in two places: the CLI validates a plugin directory
offline (`stigmer validate -f <dir>`), and the server parses an uploaded
archive when it installs a plugin. One implementation means a plugin that
validates offline installs, and a plugin that is refused offline is refused
by the server with the same sentence. The library is pure over a
`PluginFiles` reader (a sorted list of sized entries plus `read`), so each
consumer supplies its own: a directory walker in the CLI, an archive reader
in the server. Nothing here touches the filesystem, the clock, the network
or the environment, and the main entry imports no `node:*` module, so a
browser can run it too.

## Consumers

- `@stigmer/cli` (`client-apps/cli`): `stigmer validate -f <dir>` over a
  plugin directory.
- `@stigmer/server`: the plugin install pipeline, when it lands.

## Dependency policy

One runtime dependency, `yaml` (the CLI's and the SDK's YAML library), for
`SKILL.md` and sub-agent frontmatter. No dependency on `@stigmer/protos`:
the library describes the plugin format, and the CLI's offline validation
should not pull the resource schemas in for a parse. Field names in the
normalised types mirror the protos (`SubAgent`, `EnvVarDeclaration`,
`McpServerSpec`) so the server's mapping is one function per kind.

## Design notes

- **Refuse, do not skip.** The open specification tells a client to skip a
  broken component and keep loading. Stigmer refuses the plugin instead: an
  installed agent that quietly lacks a server or a sub-agent is worse than a
  refused install. The parser still scans past a fatal finding so an author
  fixes everything in one pass.
- **Every sentence lives in `src/messages.ts`**, one per finding kind,
  identifiers single-quoted. Consumers never compose refusal copy.
- **Caps are checked from declared sizes before a byte is read**
  (`PLUGIN_DOCUMENT_LIMITS`), and again on the bytes returned, so no reader
  can be talked into inflating a bomb through the library.
- **Variables are references the runner resolves.** A `${VAR}` in a server
  configuration is a reference to the caller's Environment in every dialect;
  an undeclared one is inferred as a required secret and warned, because the
  runner hands a server only the variables its spec declares.
- **Two facts about the runner shape two refusals**: a `${VAR}` in a server
  `url` is sent literally (refused), and a stdio `env` can only pass a
  declared variable by its own name, so only `KEY: "${KEY}"` is
  representable (anything else refused).
- **The `./testing` entry** builds in-memory plugins in each dialect's exact
  layout, so consumers' tests and this library's own adversarial suite craft
  fixtures from one source.
