# Dev Publishing Guide

A **dev build** is a commit of `main`, published before it is released, for
compositions that embed `@stigmer/server` (the hosted edition is one). An
open-source change such a composition needs merges here first; this repository
publishes that commit as a dev build; the composition pins the build and merges
on it, then moves to the release that carries the change.

Dev builds never go to the registries users install from. npmjs.com and ghcr.io
carry releases only ([Release Workflow Guide](release-workflow.md)). Dev builds
live in Stigmer's own Google Artifact Registry, in two publicly readable
repositories:

| What | Where | Example |
| --- | --- | --- |
| npm packages | `https://us-central1-npm.pkg.dev/pc-stigmer-foundation/stigmer-npm/` | `@stigmer/server@0.1.0-dev.20261017120000.g10c87982a0f1` |
| Sandbox runner image | `us-central1-docker.pkg.dev/pc-stigmer-foundation/stigmer-oss/runner` | `…/stigmer-oss/runner:v0.1.0-dev.20261017120000.g10c87982a0f1` |

Anyone can install or pull them without a login; only this repository's
publishing workflows can write them. Every release's npm packages are copied
into the same npm repository too ([`release.npm-mirror.yaml`](../release.npm-mirror.yaml)),
so a consumer that routes the `@stigmer` scope there installs a release and a
dev build from one place, and moving between them is a version change.

## TL;DR

**Publish** (after the change has merged to `main`):

```bash
make publish-dev               # dispatches release.dev on main
make publish-dev base=0.2.0    # pin the base version
```

The run's summary prints the version, the image, and the pin line.

**Consume**, once per project, beside its `package.json`:

```ini
# .npmrc
@stigmer:registry=https://us-central1-npm.pkg.dev/pc-stigmer-foundation/stigmer-npm/
```

then pin every `@stigmer/*` package at the one version the run printed.

**Try unmerged work** without publishing anything:
`make stage-server-library` (below).

---

## Design principles

1. **Separate pipeline, pristine production.** Dev builds run through
   [`release.dev.yaml`](../release.dev.yaml), a dispatch-only workflow. The
   production `release.*` workflows only ever publish `v*` releases.

2. **Off the public shelves.** A dev build is not something a user should
   install by accident or find in a package's version history, so it is never
   published to npmjs.com or ghcr.io. Stigmer's own registry keeps it readable
   by address (it is built from this public source) and invisible to anyone
   browsing those registries.

3. **From `main` only.** Every dev build is a commit a composition can merge on.
   The workflow refuses any other ref in its first job, and the publisher's
   trust (below) admits `main` and release tags only, so a branch can never
   write the repositories compositions install from.

4. **Keyless.** No token is stored anywhere. A publishing job exchanges its
   GitHub OIDC token for a short-lived token of a Google service account that
   may write the two repositories and nothing else.

5. **npm decides where packages go.** The workflow points the `@stigmer` scope
   at the npm repository (`actions/setup-node` with `registry-url` and
   `scope`); npm publishes a scoped package to its scope's registry; and the
   publish scripts wait on and smoke-install from that same registry
   ([`scripts/publish-standalone.mjs`](../../../scripts/publish-standalone.mjs),
   `configuredRegistry`). No script names the registry.

6. **Dev versions never collide with a release.** Every dev version carries a
   `-dev.<stamp>` suffix and targets the *next* unreleased version, so it sorts
   below the release it precedes and can never shadow one (the failure mode
   behind issue #156).

---

## Versioning scheme

`release.dev.yaml` derives one **base** version (the next patch after the newest
stable `v*` tag, or `0.1.0` while the line has no release yet, unless you pass
`base=X.Y.Z`; [`scripts/lib/line-base.mjs`](../../../scripts/lib/line-base.mjs)
is the rule, which `make release` tags by too) and stamps it:

| Artifact | Version | Notes |
| --- | --- | --- |
| npm | `X.Y.Z-dev.<UTCstamp>.g<sha12>` under tag `dev` | Unique per publish. `g<sha12>` is the first 12 characters of the commit the build came from ([`scripts/lib/dev-version.mjs`](../../../scripts/lib/dev-version.mjs)). |
| Sandbox runner | `runner:v<npm version>` (and `dev-<sha12>`, the bytes the smoke tested) | Published before the server, after the in-image smoke. Never `latest` or `prod`; the layer inside is a development layer (empty `/runner/RELEASE`). No `runner-base` or `runner-layer`. |

---

## Publishing

`make publish-dev` runs `gh workflow run release.dev.yaml --ref main`. It prints
a `gh run watch ...` command; the run's summary has the copy-paste pin line. You
can also run it from the GitHub UI: **Actions → release.dev → Run workflow**, on
`main`.

What one run publishes, in order:

1. Every workspace library (`scripts/publish-libs.mjs`), under the `dev` tag.
2. The sandbox runner image, smoke-tested in the image
   ([`release.runner-images.yaml`](../release.runner-images.yaml)).
3. `@stigmer/runner` and its slim packages, `@stigmer/server` (after the runner
   image, so a server version always has its runner), then `@stigmer/enterprise`
   at the same version, each through `scripts/publish-standalone.mjs` with its
   consumer-install smoke.

Python, Java, the Go SDK, the Rust crate and the MCP server image have no dev
build. Their consumers install releases; Go and Rust can follow a commit of
`main` by git ref (`go get go.stigmer.ai/sdk@<sha>`, a Cargo `git` dependency
with `rev`).

---

## Consuming

A dev build is pinned by its exact version, never by the `dev` tag:
`@stigmer/server` and every other `@stigmer/*` dependency at the same
`X.Y.Z-dev.<stamp>.g<sha12>`. A consumer that merges on a dev build is expected
to check that the commit the version names is on this repository's `main`,
which it can do with no lookup. A production image never carries a dev build:
the consumer moves to a release before anything ships.

With the scope line in place, `npm install`, `npm ci` and a Docker build that
copies the `.npmrc` beside the manifest all fetch `@stigmer/*` from the npm
repository with no credential. Releases are there too, so the line stays when
the pin moves to a release.

A composition that selects its runner by its pin launches
`…/stigmer-oss/runner:v<pinned version>` for a dev build and
`ghcr.io/stigmer/runner:v<version>` for a release. The open-source server itself
launches `runner:latest` for any version that is not a release.

### Trying unmerged work

`make stage-server-library` packs the server, the `@stigmer/*` libraries it
links and `@stigmer/enterprise` from your working tree, at one
`0.0.0-local.<stamp>` version, into `backend/services/stigmer-server/stage/library`
(`out=<dir>` moves it). The consumer installs every tarball in one
`npm install --no-save <dir>/pkgs/*.tgz`, which changes neither its
`package.json` nor its lockfile; its next `npm ci` puts its pin back. Nothing
leaves your machine. `npm link` is not a substitute: a linked package resolves
its dependencies from this repository's `node_modules`, which gives the
consumer a second copy of every package the server declares in
`stigmerPublish.consumerCheck.singleCopy`.

---

## Infrastructure prerequisites

The repositories and the publisher are Stigmer's own Google Cloud resources. The
workflows read four **repository Variables** (identifiers, not secrets):

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_IMAGE_PUBLISHER` | `github-image-publisher@pc-stigmer-foundation.iam.gserviceaccount.com` |
| `STIGMER_NPM_REGISTRY` | `https://us-central1-npm.pkg.dev/pc-stigmer-foundation/stigmer-npm/` |
| `STIGMER_OSS_REGISTRY_ROOT` | `us-central1-docker.pkg.dev/pc-stigmer-foundation/stigmer-oss` |

The provider admits a token only from `release.dev.yaml`,
`release.runner-images.yaml` and `release.npm-mirror.yaml` in this repository,
on `main` or a `v*` tag. The publisher may write `stigmer-npm` and `stigmer-oss`
and nothing else; both repositories grant read to everyone.

The release lanes keep their own credentials (`NPM_TOKEN` for npmjs.com, the
workflow token for ghcr.io); only the mirror job among them takes a Google
token.

---

## What's intentionally out of scope

- **Desktop installers and the website** are apps, not dependencies another
  project references, so they have no dev build.
- **Signing and provenance** are release concerns; a dev build is a step on the
  way to the release that carries its change.
