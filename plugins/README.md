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
