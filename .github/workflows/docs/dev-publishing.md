# Dev Publishing Guide

This document explains how to publish and consume **dev builds** of the Stigmer
dependencies — throwaway, on-demand builds that let two developers iterate across
repos fast. One person publishes a dev build; the other bumps a version
reference and tries it within minutes.

It is the dev-channel counterpart to the production
[Release Workflow Guide](release-workflow.md). Production releases are immutable,
signed, and published in lockstep under a `v*` tag. Dev builds are deliberately
the opposite: ephemeral, unsigned, and published on demand to each ecosystem's
**native dev channel** so they never pollute a production release index.

## TL;DR

**Publisher** (the person making changes):

```bash
# From your feature branch, publish dev builds of everything:
make publish-dev

# Or scope it and/or pin the base version:
make publish-dev targets=maven,npm
make publish-dev targets=maven base=3.1.0
```

**Consumer** (the person trying the changes): after a **one-time** per-language
setup (below), switching a dependency between a dev build and a prod release is
**only a version-string change** — nothing else.

| Language | Prod reference | Dev reference |
| --- | --- | --- |
| Java (Maven) | `ai.stigmer:stigmer-java:3.0.0` | `ai.stigmer:stigmer-java:3.0.1-SNAPSHOT` |
| npm | `@stigmer/react@3.0.0` | `@stigmer/react@dev` |
| Python | `stigmer==3.0.0` | `stigmer==3.0.1.dev<N>` (from TestPyPI) |
| Go | `...@v3.0.0` | `...@<branch>` |
| Rust | crates.io `"3.0.0"` | `{ git = "...", branch = "..." }` |

---

## Design principles

1. **Separate pipeline, pristine production.** Dev builds run through
   [`release.dev.yaml`](../release.dev.yaml), a dispatch-only workflow.
   The production `release.*` workflows are never touched and only ever publish
   real `v*` releases.

2. **Native ephemeral channel per ecosystem.** We do not invent one shared dev
   registry. Each ecosystem already has a purpose-built dev mechanism, and using
   it is the least surprising thing for any future contributor:
   - Maven → `-SNAPSHOT` to the Sonatype Central **snapshot** repository
     (mutable, auto-expired).
   - npm → a dedicated `dev` **dist-tag** on the same public npm registry.
   - Python → **TestPyPI**, the throwaway PyPI.
   - Go / Rust → a **git ref** (no publish step at all).
   - MCP server → a `dev-<sha>` **Docker tag** on GHCR.

3. **One-time consumer setup, then version-string-only switching.** For Maven and
   Python the dev channel lives at a different URL than the prod channel, so the
   consumer declares it **once**. After that the dev and prod channels coexist in
   the consumer's config, and flipping a dependency dev↔prod is only a
   version-string change. The consumer never edits config to switch back and
   forth. For npm and Go there is nothing to add at all.

4. **Dev versions never collide with a release.** Every dev coordinate carries a
   `-SNAPSHOT` / `-dev.<stamp>` / `.dev<N>` suffix and targets the *next*
   unreleased version. This structurally prevents a dev artifact from shadowing a
   real release (the failure mode behind issue #156, where a published
   `@stigmer/protos` shadowed the in-repo workspace stub).

---

## Versioning scheme

`release.dev.yaml` derives a single **base** version (the next patch after the
latest `v*` tag, unless you pass `base=X.Y.Z`) and stamps each ecosystem with the
suffix it expects:

| Channel | Version | Notes |
| --- | --- | --- |
| Maven | `X.Y.Z-SNAPSHOT` | Stable, mutable pointer — republish endlessly. |
| npm | `X.Y.Z-dev.<UTCstamp>` under tag `dev` | Unique per publish; `@dev` always resolves the newest. |
| Python | `X.Y.Z.dev<epoch>` on TestPyPI | PEP 440 dev release. |
| Docker | `:dev-<shortsha>` (and a moving `:dev`) | On GHCR. |

---

## Publishing

### Recommended: dispatch the workflow (`make publish-dev`)

This keeps all publishing credentials in GitHub Actions — nothing sensitive on
your laptop — and gives you an audit log.

```bash
make publish-dev                       # all targets, auto base version
make publish-dev targets=maven,npm     # subset
make publish-dev base=3.1.0            # pin the base version
```

`make publish-dev` runs `gh workflow run release.dev.yaml` against your **current
branch**, so you publish dev builds straight off your feature branch. It prints a
`gh run watch ...` command to follow the run; the run's **summary** page contains
a copy-paste block of the exact consumer coordinates for everything it published.

> First-time note: a `workflow_dispatch` workflow only becomes dispatchable once
> the workflow file exists on the repository's **default branch**. Merge
> `release.dev.yaml` to `main` once; thereafter it can run against any branch.

You can also run it from the GitHub UI: **Actions → release.dev → Run workflow**.

### Fastest inner loop: publish locally from your working tree (`make publish-dev-local`)

`make publish-dev` requires you to **commit and push** first (CI checks out the
ref from GitHub). For a tight inner loop, `make publish-dev-local` publishes
**straight from your working tree** — no commit, no push, no CI wait:

```bash
make publish-dev-local                    # all targets, auto base version
make publish-dev-local targets=npm,maven  # subset
make publish-dev-local targets=maven      # Maven only
make publish-dev-local base=3.1.0         # pin the base version
```

(`make publish-dev-maven-local` is kept as an alias for `targets=maven`.)

It derives the same dev versions, publishes to the same channels (npm `dev` tag,
Maven SNAPSHOT, TestPyPI, GHCR), and prints the same consumer coordinates. It is
backed by [`scripts/publish-dev-local.sh`](../../../scripts/publish-dev-local.sh).

**Credentials come from Planton secrets**, fetched at runtime and never written
to disk (GitHub Actions secrets are write-only and cannot be read back, so they
can't drive a local run). Required secrets in the `stigmer` org — each a
single-value secret stored under the key `value`:

```bash
planton secret set npm-token              value=npm_xxxxxxxx          # npmjs.com automation token
planton secret set maven-central-username value=XXXX                  # Sonatype Central user-token username
planton secret set maven-central-password value=YYYY                  # Sonatype Central user-token password
planton secret set testpypi-token         value=pypi-xxxxxxxx         # test.pypi.org API token
# ghcr-stigmer-pat already exists in the org (used for the MCP Docker push)
```

**Requirements / notes:**

- **Planton CLI**: the script reads secrets with `planton secret get --key value
  -o plain`. Release CLIs return the raw value; older/dev builds that print a
  decorated table are handled too (the script extracts the value cell and rejects
  anything that comes back with embedded whitespace, as a corruption guard).
- The local TestPyPI upload uses an **API token**, which sidesteps the OIDC
  trusted-publisher configuration the CI workflow needs.
- The MCP Docker push infers your GitHub username from `gh`; override with
  `GHCR_USER=<login>` if needed. Multi-arch is the default; set
  `DOCKER_PLATFORMS=linux/arm64` to build a single arch faster.
- The script stamps versions into `pom.xml` / `pyproject.toml` while building and
  **restores them on exit** (even on failure), preserving any pre-existing
  uncommitted edits to those files.

> Trade-off: the local path has no CI audit trail and weaker build provenance
> than `make publish-dev`. Use it for fast iteration; prefer `make publish-dev`
> for builds you want recorded.

---

## Consumer setup (one-time per language)

### Java (Maven)

Add the Central snapshot repository to the consuming project's `pom.xml` **once**.
It coexists with Maven Central; it is only consulted for `-SNAPSHOT` versions, so
your prod (release) dependencies are unaffected.

```xml
<repositories>
  <repository>
    <id>central-snapshots</id>
    <url>https://central.sonatype.com/repository/maven-snapshots/</url>
    <releases><enabled>false</enabled></releases>
    <snapshots><enabled>true</enabled></snapshots>
  </repository>
</repositories>
```

Then switch the dependency version only:

```xml
<!-- prod -->
<dependency>
  <groupId>ai.stigmer</groupId>
  <artifactId>stigmer-java</artifactId>
  <version>3.0.0</version>
</dependency>

<!-- dev (only the version changed) -->
<dependency>
  <groupId>ai.stigmer</groupId>
  <artifactId>stigmer-java</artifactId>
  <version>3.0.1-SNAPSHOT</version>
</dependency>
```

Force-refresh to the latest snapshot with `mvn -U ...`.

### npm

Nothing to configure — the `dev` dist-tag lives on the same public npm registry as
`latest`. Switch the version reference only:

```bash
npm install @stigmer/react@3.0.0   # prod
npm install @stigmer/react@dev     # dev (latest dev build)
```

`@dev` always resolves to the newest dev build. To pin an exact dev build, use the
full `3.0.1-dev.<stamp>` version from the run summary.

### Python (TestPyPI)

dev builds go to TestPyPI. Point pip at TestPyPI **with PyPI as an extra index**
(so transitive deps still resolve from prod PyPI) and pass `--pre`:

```bash
# prod
pip install stigmer

# dev (TestPyPI)
pip install \
  -i https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  --pre 'stigmer==3.0.1.dev<N>'
```

To make this a one-time setup, add the extra index to your `pip.conf`
(`~/.config/pip/pip.conf` on Linux/macOS):

```ini
[global]
extra-index-url = https://test.pypi.org/simple/
pre = true
```

### Go (no publish — git ref)

The Go SDK is consumed by module path. Prod uses a tag; dev uses your branch:

```bash
go get github.com/stigmer/stigmer/sdk/go@v3.0.0      # prod
go get github.com/stigmer/stigmer/sdk/go@my-branch   # dev
```

### Rust (no publish — git dependency)

crates.io is immutable, so dev iteration uses a git dependency in `Cargo.toml`:

```toml
# prod
stigmer-runner-host = "3.0.0"

# dev
stigmer-runner-host = { git = "https://github.com/stigmer/stigmer", branch = "my-branch" }
```

### MCP server (Docker)

```bash
docker pull ghcr.io/stigmer/mcp-server-stigmer:dev-<sha>
```

---

## Infrastructure prerequisites

One-time account/secret setup. There are **two credential planes**:

- **CI path** (`make publish-dev`) reads **GitHub Actions secrets**.
- **Local path** (`make publish-dev-local`) reads **Planton secrets** (GitHub
  Actions secrets are write-only and cannot be read back). The Planton slugs are
  listed in the local-publish section above.

### Maven credentials

- Both paths publish to the Central snapshot repo. **Snapshot publishing must be
  enabled** for the Sonatype Central account/namespace, and the same account also
  needs **release publishing** enabled for production releases.
- CI: the existing `MAVEN_CENTRAL_USERNAME` / `MAVEN_CENTRAL_PASSWORD` GitHub
  secrets (same `central` server id as the release workflow).
- Local: the `maven-central-username` / `maven-central-password` Planton secrets.
  The script generates a temporary `settings.xml` referencing them via
  `${env.*}`, so you do **not** need to edit your `~/.m2/settings.xml`.

### TestPyPI (Python)

- CI: publishes via **OIDC Trusted Publishing** (matching
  `release.python-sdk.yaml`). A Trusted Publisher must be configured on
  `test.pypi.org` for **both** projects (`stigmer` and `stigmer-protos`), pointing
  at this repository and the `release.dev` workflow.
- Local: uses the `testpypi-token` Planton secret (an API token), which does not
  require the trusted-publisher setup.

### npm

- CI: reuses the existing `NPM_TOKEN` GitHub secret.
- Local: uses the `npm-token` Planton secret.

### GHCR (MCP Docker)

- CI: uses the workflow's `GITHUB_TOKEN`.
- Local: uses the existing `ghcr-stigmer-pat` Planton secret.

### Planton CLI (local path only)

The local path reads secrets via the Planton CLI. It works with both release
CLIs (clean `-o plain` output) and older/dev builds (decorated table, parsed by
the script). A parsed value containing whitespace is rejected as a corruption
guard.

---

## What's intentionally out of scope

- **Desktop installers, the website, and the cloud sandbox image** are apps /
  deployables, not dependencies another developer references, so they have no dev
  channel here.
- **Signing / provenance / lockstep** are production-release concerns. Dev builds
  are explicitly throwaway and skip them for speed.
