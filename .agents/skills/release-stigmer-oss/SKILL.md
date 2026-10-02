---
name: release-stigmer-oss
description:
  Cuts a Stigmer OSS release by checking the release hold and the pins, deciding
  the semver bump by impact, writing release notes with a Highlights section,
  and creating and pushing the annotated tags that trigger every release
  workflow. Invoke by name when asked to release, cut, or tag a release.
disable-model-invocation: true
---

# Release Stigmer OSS

A release is two annotated tags pushed from a commit on `main` whose release
pins already name the new version. Every `release.*.yaml` workflow triggers on
the `v*` tag; the `sdk/go/v*` tag exists for the Go module proxy. `make release`
performs the mechanics with a plain tag message; this skill wraps it with the
judgement the Makefile cannot make (the bump, the notes) and runs the same
preflight it does.

Releases are batched. Finishing an issue or a pull request never cuts one: the
change merges to `main` and ships with the next release, which the maintainer
cuts on the release train (on a fixed weekly day, or whenever the maintainer
asks for a train), and every change merged since the previous `v*` tag ships in
it. A plan names a release of its own only when the maintainer rules that its
change cannot wait for the train. On 2026-09-28 ten releases were cut in one
day, one per change, each running the whole release fleet; the train replaces
that.

## 0. Preflight: the hold and the working tree

```bash
make release-preflight
git status --short
```

`release-preflight` refuses while `RELEASE_HOLD.md` exists at the repository
root and prints it. A hold names a change that is merged on `main` but must not
ship until another has merged too; only a maintainer lifts it, by deleting the
file in the pull request that lands the awaited change. When the preflight
refuses, show the hold to the user and stop. Never tag under a hold.

A dirty tree stops here too unless the user says otherwise; the tag must point
at a commit that the remote's `main` already has.

## 1. Previous release and the commits since

```bash
git tag -l "v*" | sort -V | tail -n1
git log --oneline <previous-tag>..HEAD
```

Report both so the user sees what ships.

## 2. The bump, by impact

The presence of a `feat` commit is not a minor bump. Judge the change:

- **major**: a `BREAKING CHANGE:` footer or `!` after the type; a public
  contract changes incompatibly for consumers who never touched the part that
  changed: a proto field or message is renamed, a wire value changes meaning, an
  SDK export's signature changes, a Go import path moves. A Go major is itself a
  migration for every Go consumer (the module path suffix and every import
  change with it, section 5), so a major is graded on what it does to consumers
  who did not use the removed surface.
- **minor, with an Upgrading section**: a surface is removed outright (a kind, a
  proto package, an SDK client or subpath, a CLI mode) and no known consumer
  used it; the release notes name every removed surface under Upgrading so a
  consumer who did use it learns at the release, not the build. The Project
  kind's removal set the precedent.
- **minor**: a new capability that expands what users or platform builders can
  do: a new API resource, a new CLI command, a new SDK domain, a product-level
  feature. The bar: would this earn a section in release notes that makes
  someone want to upgrade?
- **patch**: everything else: bug fixes, incremental enhancements inside an
  existing feature, refactors, CI, docs, tooling, performance, tests. Most
  day-to-day `feat` commits are patch-level.

Default to patch. A release can always be followed by another; version inflation
cannot be undone. Present the reasoning and the proposed version and wait for
the user's confirmation.

## 3. Bump the pins and commit them

Five pins travel in the commit the tag is cut from, and `make release` refuses
to tag until all five name the new version: the MCP server image version in
`mcp-server/Dockerfile` (the npm publish lane refuses a version that does not
match it; production deploys the pin, not the tag), the compose stack's
`STIGMER_VERSION` in `docker-compose.yml` and `.env.example` (the stack a fresh
clone runs), `version` and `appVersion` in `deploy/helm/stigmer/Chart.yaml` (the
chart's image tags default to the app version), and the two upgrade examples on
`docs/guides/self-hosting/operations.mdx` (the version a reader copies into
`.env` and into `helm upgrade --version`; the page went stale once when nothing
owned it).

Nothing reaches `main` but through the merge queue, so the pins go in a pull
request of their own:

```bash
git fetch origin
git switch -c chore/release-pins-<X.Y.Z> origin/main
make release-pins version=<X.Y.Z>
git commit -am "chore(release): bump the release pins to <X.Y.Z>"
git push -u origin chore/release-pins-<X.Y.Z>
gh pr create --title "chore(release): bump the release pins to <X.Y.Z>" --body "The five release pins for v<X.Y.Z>."
# review it (.agents/skills/review-pull-request/SKILL.md): Review verdict is required too
gh pr merge <n> --auto --match-head-commit "$(git rev-parse HEAD)"
gh pr view <n> --json state,mergeCommit   # repeat until MERGED
git switch main && git pull --ff-only
```

The pins touch the docs, compose-stack and helm-chart lanes' paths, so `Gate`
runs those three on the pull request and again in the queue: expect about half
an hour before it merges. They build from source, so they stay green before the
images exist. Tag the merged commit (`main`'s head once the pull request says
`MERGED`); `make release` refuses a `HEAD` whose pins disagree.

## 4. Release notes

An annotated tag message in Markdown. Highlights first, in plain language for
people who use Stigmer, not a restatement of commit subjects: one short
paragraph per capability worth upgrading for, in the vocabulary the docs use.
When an operator must act, or a behaviour they rely on changes (a permission, a
default, a version they must move in step), an Upgrading section follows
Highlights and says so in one bullet each; omit the section when nothing changes
for them. Then the changes grouped by Conventional Commit type, imperative, one
line each, scope in bold, empty groups omitted, merge commits and maintenance
noise skipped (repository tooling and agent guidance are chores, whatever their
commit type). Blank lines are paragraph breaks and reach the release page as
written; keep them.

```text
Release v<X.Y.Z>

## Highlights

<one short paragraph per headline capability: what it lets a user do and why to upgrade>

## Upgrading

- <what an operator must do or will see change; omit the section when nothing changes for them>

## What's Changed

### Features
- **<scope>**: <description>

### Bug Fixes
- **<scope>**: <description>

### Documentation
- **<scope>**: <description>

### Chores
- <description>

**Full Changelog**: https://github.com/stigmer/stigmer/compare/<previous>...v<X.Y.Z>
```

## 5. Tag and push

```bash
git tag -a "sdk/go/v<X.Y.Z>" -m "Release sdk/go v<X.Y.Z>"
git tag --cleanup=verbatim -a "v<X.Y.Z>" -m "<the notes from step 4>"
git push origin "sdk/go/v<X.Y.Z>" "v<X.Y.Z>"
```

`--cleanup=verbatim` matters: the notes contain Markdown headings, and git's
default cleanup treats lines starting with `#` as comments and drops them.

The Go SDK is a v2+ module: `sdk/go/go.mod` declares the major-version suffix in
its module path and consumers import it with that suffix. The Go tag's name (the
module directory followed by the version) is already correct for that layout; do
not rename the tag or move the module into a versioned directory. When the major
version changes, the module path suffix and every internal import path change
with it.

Never force-push a tag; if one exists, stop and say so.

## 6. What CI does next

Every lane triggers on the `v*` tag; the list is
`.github/workflows/release.*.yaml` and `make release` prints the summary. In
short: protos to the Buf registry; CLI binaries and the GitHub release; desktop
installers as a draft; the `@stigmer/*` npm packages including `@stigmer/server`
(the library the cloud composition pins) and `@stigmer/server-slim`, with the
server, runner and all-in-one images pushed to GHCR and the Helm chart to its
OCI registry, each smoked before promotion; the Go SDK through the module proxy;
the Python packages to PyPI; the Java SDK to Maven; the MCP server image; the
Rust crate; the sandbox cloud image, whose `runner:v<version>` tag and `prod`
appear only after its smoke test passes. When the npm release succeeds for a
release tag (a prerelease tag ends the run green with nothing run),
`ci.live.yaml` runs the tagged commit's live suites and the published CLI
against the real model providers. A red run files a `live-failure` issue: a
broken provider path is fixed like any defect, an outage is waited out, and a
person closes the issue once a dispatch of the workflow runs green. A dispatch
installs a published CLI, so a fix on the CLI's side needs a release first.
