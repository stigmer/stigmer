# Java SDK Maven Central Publishing Setup

**Date**: March 16, 2026

## Summary

Configured `stigmer-java` and `stigmer-java-stubs` for publishing to Maven Central via the new Sonatype Central Portal. Both POMs now carry the required Central metadata and a `release` profile with signing and publishing plugins. A GitHub Actions workflow automates the full publish pipeline, and the SDK README documents installation for Maven, Gradle (Groovy), and Gradle (Kotlin DSL) consumers.

## Problem Statement

The Java SDK (`ai.stigmer:stigmer-java`) was built and tested locally but had no path to Maven Central. Java consumers couldn't `<dependency>` on it.

### Pain Points

- No Maven Central metadata in either POM (url, licenses, developers, scm)
- No GPG signing or source/javadoc JAR generation configured
- No release workflow for automated publishing
- No SDK README with installation instructions
- The stubs artifact (`stigmer-java-stubs`) also needed Central metadata, since it's a transitive dependency consumers must resolve

## Solution

Added Maven Central publishing infrastructure following the same patterns as the existing Python (`release.python-sdk.yaml`) and TypeScript (`release.npm-libs.yaml`) release workflows:

1. **Both POMs** get the six required Central metadata blocks and a `release` profile containing signing + publishing plugins
2. **A three-job GitHub Actions workflow** publishes stubs first, then SDK (matching the Python stubs-then-SDK pattern)
3. **An SDK README** documents installation for all Java build tools

## Implementation Details

### POM Changes (`apis/stubs/java/pom.xml` and `sdk/java/pom.xml`)

- Added `<url>`, `<organization>`, `<licenses>` (Apache 2.0), `<developers>`, `<scm>` metadata blocks
- Added `<profile id="release">` containing:
  - `central-publishing-maven-plugin` 0.9.0 with `autoPublish=true`, `waitUntil=published`
  - `maven-gpg-plugin` 3.2.8 with `--pinentry-mode loopback` for CI
  - `maven-source-plugin` 3.3.1 (`jar-no-fork` goal)
  - `maven-javadoc-plugin` 3.11.2
- Extracted stubs dependency version into `stigmer-stubs.version` property for workflow version stamping

### Release Workflow (`.github/workflows/release.maven.yaml`)

- **Trigger**: `v*` tags + `workflow_dispatch` (same as all other SDK workflows)
- **Job 1 `determine-version`**: Extracts version from tag or manual input
- **Job 2 `publish-stubs`**: Sets version via `mvn versions:set`, deploys with `-P release`
- **Job 3 `publish-sdk`** (needs publish-stubs): Runs codegen, updates stubs dep version, installs stubs locally (to avoid Central propagation delay), deploys
- Uses `actions/setup-java@v4` for Java 21 + GPG import + server credential wiring

### SDK README (`sdk/java/README.md`)

Follows the established pattern from Python/Go/TypeScript READMEs: Installation (Maven + Gradle), Quick Start, Resource Clients table, Common Operations, Cross-Resource Search, Error Handling, Configuration, Code Generation.

### Owner Setup (completed in this session)

- GPG key generated (RSA 4096, key ID `29D50099`) and published to `keyserver.ubuntu.com`
- DNS migrated from GoDaddy to Cloudflare for `stigmer.ai`
- Maven Central namespace `ai.stigmer` verified via DNS TXT record
- GitHub secrets configured: `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`, `MAVEN_CENTRAL_USERNAME`, `MAVEN_CENTRAL_PASSWORD`

## Benefits

- Java developers can now install the SDK with a single Maven/Gradle dependency
- Releases are fully automated: tag push triggers build, sign, and publish
- Normal development builds (`mvn compile`, `mvn test`) are unaffected by the release plugins
- Stubs are published as a separate artifact, matching the Python and TypeScript patterns

## Impact

- **SDK consumers**: Can depend on `ai.stigmer:stigmer-java` from Maven Central once the first release tag is pushed
- **CI/CD**: New workflow added to the release pipeline; all SDKs continue to release in lockstep via `v*` tags
- **Existing builds**: Zero impact -- release plugins are isolated in a profile

## Related Work

- `2026-03-16-141930-java-sdk-wired-into-build-pipeline.md` -- Task 4 (predecessor)
- `2026-03-16-140949-java-sdk-remove-internal-from-generated-package.md` -- Package restructure
- `2026-03-16-141003-pypi-publishing-setup-and-stigmer-protos-rename.md` -- Python publishing (same pattern)

---

**Status**: Production Ready
**Timeline**: Task 5 of the Java SDK codegen project (20260316.02)
