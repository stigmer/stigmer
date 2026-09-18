# @stigmer/plugins

Stigmer's **official plugin marketplace**: a directory tree with a root
`marketplace.json` and one Agent Plugins package per entry. It is what a fresh
`stigmer up` bootstraps a backend with (the `defaults` list, installed into the
`stigmer` organization as public) and what `stigmer install <name>` and
`stigmer marketplace show stigmer` read when no other marketplace is named.

The tree follows the convention Cursor (`cursor/plugins`), Claude Code
(`anthropics/claude-code`) and Codex publish: the marketplace file at the root,
each plugin in its own folder, nothing else needed. The CLI reads all four
dialects; this file is the Stigmer dialect, the one with a `defaults` list.

## Layout

```text
plugins/
  marketplace.json        the catalogue: name, owner, plugins[], defaults[]
  assistant/              one plugin per folder, in the open Agent Plugins format
    plugin.json           the manifest (root plugin.json with $schema)
    ai.stigmer/agent.yaml Stigmer's own overlay: the Agent this plugin installs
    icon.svg
  __tests__/              the static suite (make test-plugins-static)
  scripts/stage-content.mjs
  scripts/audit/          the vendor-catalogue audit (make audit-plugins)
  scripts/lib/            what the audit and the vendoring share
```

`marketplace.json` is the one definition of the content set: an entry's `source`
names its folder, and `stage-content.mjs` copies exactly the listed folders into
`dist/`, so a folder that is not listed never reaches npm and a listed folder
that is missing fails the build.

## How a plugin joins the catalogue

1. Add its folder under `plugins/<name>/` in the open Agent Plugins format
   (`plugin.json` with `$schema`), portable to Cursor, Claude Code and Codex.
   Anything only Stigmer reads goes under `ai.stigmer/`.
2. List it in `marketplace.json` (`{ "name": "<name>", "source": "./<name>" }`).
   Add it to `defaults` only if every fresh install should get it.
3. `make test-plugins-static`: the file and the tree agree, every entry reads
   clean under its own name with a version and a description, each agent overlay
   names its own plugin, and exactly one entry carries the default-agent label.
4. `stigmer validate -f plugins/<name>` for the offline read the server will
   repeat, and `stigmer install stigmer/<name>` from a checkout to see it land.

## Inclusion rubric

A plugin enters the catalogue when all six hold. The audit
(`scripts/audit/classify.ts`) is these rules as code, numbered the same, and
its report lists every rule an entry fails.

1. **We may ship it.** Its folder, or the repository it comes from, carries a
   licence that permits redistribution (MIT, Apache 2.0, BSD), or Stigmer
   authored it. A licence the audit cannot recognise is read by a person, never
   assumed.
2. **It becomes something.** At least one skill, sub-agent or MCP server.
   Rules, hooks and commands are components Stigmer does not install; a plugin
   made only of those installs as nothing.
3. **Every MCP server is reachable from Stigmer.** An HTTP endpoint that
   answers the handshake without a credential, takes a key through a declared
   variable, or answers with a standard OAuth challenge whose metadata resolves
   to a login server. An endpoint that answers with a challenge that is not
   OAuth, an error, or nothing at all is out; so is a host that wants a
   vendor's own credential (`api.cursor.com`) until it is re-measured.
4. **No stdio server.** The cloud runner does not spawn local processes; a
   catalogue promise that fails on cloud is a broken one.
5. **Not a personal-account tool** (a person's own mail, calendar, drive or
   contacts). Grants are per organization today, so one member's sign-in would
   serve every colleague's sessions; these wait for per-user grants. The audit
   flags on a word and lists the flags for a maintainer to move.
6. **Its login server registers clients dynamically.** Sign in cannot complete
   against a vendor that requires a pre-registered OAuth app until Stigmer holds
   one with that vendor; the audit lists these vendors so that programme has
   its list.

Two shapes satisfy rule 1. A **vendored** plugin is copied from a vendor's
repository at a pinned commit with its licence and a `NOTICE` beside it, plus
our `ai.stigmer/` overlay where one is needed. An **authored** plugin is
Stigmer's own manifest in the open format naming a vendor's public MCP
endpoint; a URL is a fact, and no vendor text is copied. Anything we may not
redistribute and do not author stays reachable through Add source, pointing at
the vendor's repository, as the user's own act.

## Auditing the vendors

`make audit-plugins ARGS="--out <dir>"` reads the vendors' catalogues (the
GitHub sources the product lists in `@stigmer/plugin-package/client`), each at
its default branch or at `--ref owner/repo=<sha>`, through the same
preparation chain an install runs (`preparePluginFromTree`: ignore rules,
security defaults, the reader, the digest), so "what this entry becomes" in
the report is what an install would produce. It probes every distinct hosted
MCP endpoint once, unauthenticated, with the request and the 401 rule the
runner uses at a first tool call (`mcp-oauth-detect.ts` is the rule's home),
then follows the challenge's metadata (RFC 9728, then RFC 8414) to learn
whether the login server registers clients and where it lives. It writes
`audit.md`, the report a maintainer strikes names from, and `audit.json`, every
fact and every probe's raw evidence, pinned to the commits read.

Network, by hand, at curation time; never in CI. The static suite proves the
audit's classifier, probe ladder and licence reader over fixtures
(`__tests__/audit-*.test.ts`), so a verdict cannot change without a test
saying so.

## Delivery

`scripts/publish-libs.mjs` publishes `dist/` as `@stigmer/plugins` at every
release, in lockstep with `@stigmer/cli`. A released CLI acquires the package at
its own version into `~/.stigmer/runtimes/<version>/` on the first `stigmer up`,
so the content a fresh install bootstraps with matches the control plane that
installs it; from a checkout, the CLI reads this tree directly. The all-in-one
image bakes the package the same way it bakes the server and the runner.

## Reading it

- The format: `docs/guides/plugins/marketplace-file.mdx`.
- Installing from it: `docs/guides/plugins/install-from-a-marketplace.mdx`.
- The reader: `backend/libs/ts/plugin-package` (`readMarketplace`).
- The rule that says an endpoint wants OAuth:
  `backend/services/runner/src/shared/mcp-oauth-detect.ts`.
