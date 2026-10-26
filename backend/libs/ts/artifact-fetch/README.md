# @stigmer/artifact-fetch

How a Stigmer process fetches an artifact it did not build and runs it: the CLI installs the Temporal CLI from its GitHub release, and the runner installs the Claude engine from npm the first time a person runs an agent on Claude.

- `fetchWithRetry`: the download retry contract. A connection that resets before or during the body, a 5xx or a 429 is tried again with a doubling wait (1 s, 2 s, 4 s; four attempts); any other status is an answer; an abort is never retried.
- `downloadToFile`: a download streamed to a file while it is hashed, kept only when the whole body matches its expected digest. Memory stays at one chunk whatever the artifact's size.
- `parseShasum`, `parseIntegrity`, `sha256Digest`: the two forms a publisher states a digest in, a release's `sha256sum` line and npm's Subresource Integrity string, read into one `ExpectedDigest`.
- `parseTarHeader`, `extractTarEntry`, `readTar`, `extractPackageTarball`: one ustar reader. `extractTarEntry` takes one file by name from an archive in memory; `extractPackageTarball` unpacks a whole npm package as it streams, refusing any entry that is not a regular file under `package/` with a plain relative path, so a package never writes outside its directory.

## Why one library

The download contract was written for `stigmer up` (`client-apps/cli/src/local/artifact.ts`). The runner then needed the same contract for the Claude engine, a 120 to 140 MB package fetched on a person's machine, and a second copy would have let the two retry, verify and extract differently. So the contract moved here; the CLI keeps its asset naming, its cache and its exit errors, and the runner its engine home.

Every failure is an `ArtifactFetchError` whose `message` says what failed and whose `details` carry the facts (the URL, the expected and actual digest, what to do), so each consumer renders its own surface.

No runtime dependency: only Node built-ins. Published in lockstep with the other `backend/libs/ts` libraries by `scripts/publish-libs.mjs`; the CLI depends on it, and the runner links it with `file:` and bundles it into its single file.

## Verify

`npm run typecheck && npm test` here. The consumers' suites: `npm run test -w @stigmer/cli` and `make test-runner`.
