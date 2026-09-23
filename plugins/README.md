# @stigmer/plugins

Stigmer's **official plugin marketplace**: a directory tree with a root
`marketplace.json` and one Agent Plugins package per entry. It is what
`stigmer install <name>` and `stigmer marketplace show stigmer` read when no
other marketplace is named. Nothing in it is installed unasked: a fresh Stigmer
answers with the built-in assistant, which is the runner's own prompt and no
plugin's, so a first message needs no plugin.

The tree follows the convention Cursor (`cursor/plugins`), Claude Code
(`anthropics/claude-code`) and Codex publish: the marketplace file at the root,
each plugin in its own folder, nothing else needed. The CLI reads all four
dialects; this file is the Stigmer dialect, which the CLI looks for first.

## Layout

```text
plugins/
  marketplace.json        the catalogue: name, owner, plugins[]
  vendor.json             where every vendored folder came from; the strikes
  NOTICE                  the attribution for the vendored folders, generated
  linear/                 an authored plugin for a vendor's public MCP endpoint
    plugin.json           extensions["ai.stigmer"].displayName names the card
    mcp.json              the URL; the control plane completes its OAuth at save
  thermos/                a vendored plugin: Cursor's folder, byte for byte
  __tests__/              the static suite (make test-plugins-static)
  scripts/stage-content.mjs
  scripts/audit/          the vendor-catalogue audit (make audit-plugins)
  scripts/sync/           the sync from vendor.json to the tree (make sync-plugins)
  scripts/lib/            what the audit, the sync and the suite share
```

`marketplace.json` is the one definition of the content set: an entry's `source`
names its folder, and `stage-content.mjs` copies exactly the listed folders into
`dist/`, so a folder that is not listed never reaches npm and a listed folder
that is missing fails the build. Its `plugins` list is written by the sync
(every vendored row plus every authored folder, by name) and checked by the
suite, so the file and the tree cannot disagree.

## Two kinds of plugin

A **vendored** plugin is a directory copied from a vendor's public repository at
a pinned commit, byte for byte, file modes included, with nothing of Stigmer's
inside it: its licence is the vendor's own file beside it, and what Stigmer adds
(the pins, the notice, the marketplace entry) lives outside the folder. That is
what makes the same plugin, installed from this catalogue or from the vendor's
repository, one plugin with one digest. `vendor.json` names each one (source,
commit, path in the source, licence file); `NOTICE` restates it for a reader.

An **authored** plugin is Stigmer's own manifest in the open format, naming a
vendor's public MCP endpoint and nothing else: a URL is a fact, no vendor text
is copied, and the control plane completes the server's OAuth from the endpoint
itself when the plugin is installed. Its `extensions["ai.stigmer"]` carries the
`displayName` (and may carry `logo` and `category`) a storefront card shows,
the one place the open format leaves a client for them.

## How a plugin joins the catalogue

An authored plugin:

1. Add its folder under `plugins/<name>/` in the open Agent Plugins format
   (`plugin.json` with `$schema`, `author.name` `Stigmer`,
   `extensions["ai.stigmer"].displayName`), portable to Cursor, Claude Code and
   Codex. Anything only Stigmer reads goes under `ai.stigmer/`.
2. `make sync-plugins` writes its `marketplace.json` line.
3. `make test-plugins-static`: the files and the tree agree, every entry
   installs under its own name with a version and a description, each agent
   overlay names its own plugin, none carries the retired default-agent
   label, and npm would publish every staged file.
4. `stigmer validate -f plugins/<name>` for the offline read the server will
   repeat, and `stigmer install stigmer/<name>` from a checkout to see it land.

A vendored plugin joins through the audit and the sync (below), never by hand:
a folder copied by a person has no pin, and the suite refuses it.

## Keeping it out: strikes

`vendor.json`'s `struck` list is a person's decision as code: an entry the audit
would vendor, with the reason it stays out. The sync never re-adds a struck
entry, so the decision outlives the run that prompted it. Strike with
`make sync-plugins ARGS="--from-audit <audit.json> --strike <source>/<name>=<reason>"`
or by editing the list; lift a strike by deleting its row and re-syncing. The
first two strikes are `google-cloud-bigquery` (it asks for OAuth only at the
tool call, against a login server that does not register clients) and
`orchestrate` (it carries a `.gitignore`, which npm consumes rather than
publishes, so the released package would not be the tree).

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
3. **Every MCP server is reachable from Stigmer, as declared.** An HTTP
   endpoint that answers the handshake without a credential, takes a key
   through a declared variable that a header sends, or answers with a standard
   OAuth challenge whose metadata resolves to a login server. An endpoint that
   answers with a challenge that is not OAuth, an error, or nothing at all is
   out; so is a host that wants a vendor's own credential (`api.cursor.com`)
   until it is re-measured; and so is a server that declares a variable no
   header sends (a vendor's own sign-in block Stigmer does not read), because
   the install would ask for a secret and never use it. Its endpoint may still
   be authored on what the wire says.
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

Two shapes satisfy rule 1: the vendored and the authored plugin described
above. A vendored folder must carry its own licence file; a folder whose only
licence is its repository's root file is not copied, because the copy could
not carry the text that permits it. Anything we may not redistribute and do
not author stays reachable through Add source, pointing at the vendor's
repository, as the user's own act.

What the rubric cannot see: a server that answers the handshake and lists its
tools anonymously but asks for OAuth at the first tool call reads as `open`
(the probe never calls a tool). Such a server is a strike when a person has
measured it, with the measurement in the reason.

## Auditing the vendors

`make audit-plugins ARGS="--out <dir>"` reads the vendors' catalogues named in
`vendor.json`'s `sources`, each at its default branch or at
`--ref owner/repo=<sha>`, through the same preparation chain an install runs
(`preparePluginFromTree`: ignore rules, security defaults, the reader, the
digest), so "what this entry becomes" in the report is what an install would
produce. It probes every distinct hosted MCP endpoint once, unauthenticated,
with the request and the 401 rule the runner applies at a first tool call and
the control plane at save time (`backend/libs/ts/outbound` is the rule's
home), then follows the challenge's metadata (RFC 9728, then RFC 8414) to
learn whether the login server registers clients and where it lives. It writes
`audit.md`, the report a maintainer strikes names from, and `audit.json`, every
fact and every probe's raw evidence, pinned to the commits read.

Network, at curation time and in the weekly refresh lane; never in a test. The
static suite proves the audit's classifier, probe ladder and licence reader
over fixtures (`__tests__/audit-*.test.ts`), so a verdict cannot change without
a test saying so.

## Syncing the tree

`make sync-plugins ARGS="--from-audit <dir>/audit.json"` rewrites `vendor.json`
from the audit's verdicts (the audit's sources at the commits it read, one row
per entry the rubric vendors, minus the strikes) and then makes the tree agree
with it: each source is checked out once at its pinned commit, every row's
folder is copied over ours byte for byte, folders whose rows are gone are
removed, and `NOTICE` and `marketplace.json`'s plugin list are rewritten. A
source's commit moves only when the bytes under one of its folders or its rows
moved, so a vendor's unrelated commits change nothing here. Without
`--from-audit`, the sync re-copies from the pins as they stand. A second run
is a no-op; the sync refuses a row that would land on a folder it did not
write (an authored plugin with the same name).

## The refresh lane

`.github/workflows/catalogue-refresh.yaml` runs the audit and the sync weekly
at the vendors' current commits, runs this suite, and opens (or updates) one
pull request on the `catalogue/refresh` branch whose body is the report's
decision sections, with the full `audit.md` and `audit.json` as run
artifacts. Curation is that merge. The human acts it leaves are the ones the
report asks for: a rule-5 flag moved, an `unrecognised` licence read, a strike
added, and the merge itself. A pull request that changes the lane's own file
runs every step short of pushing, as the lane's test. The lane pushes with a
repository token (`CATALOGUE_REFRESH_TOKEN`) rather than the workflow's own,
because a pull request opened with the workflow token runs no checks.

## Delivery

`scripts/publish-libs.mjs` publishes `dist/` as `@stigmer/plugins` at every
release, in lockstep with `@stigmer/cli`. A released CLI acquires the package at
its own version into `~/.stigmer/runtimes/<version>/` the first time
`stigmer install` needs it, so what it installs matches the control plane that
serves it; from a checkout, the CLI reads this tree directly. The all-in-one
image bakes the package the same way it bakes the server and the runner.

Every consumer of a release reads the packed tree, and npm decides what a
tarball carries by rules of its own (a nested `.gitignore` is read as packing
rules and not shipped, for one). So `stage-content.mjs` asks npm what it would
publish (`npm pack --dry-run`) after staging and fails on any staged file npm
would leave out; `make test-plugins-static` runs it on every plugins pull
request. A vendored folder that cannot ship whole is struck with that reason.

## Reading it

- The format: `docs/guides/plugins/marketplace-file.mdx`.
- Installing from it: `docs/guides/plugins/install-from-a-marketplace.mdx`.
- The reader: `backend/libs/ts/plugin-package` (`readMarketplace`).
- The rule that says an endpoint wants OAuth, and the request that asks:
  `backend/libs/ts/outbound` (`@stigmer/outbound/mcp-oauth`).
