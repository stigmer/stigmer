---
name: upgrade-claude-engine
description:
  Takes the runner's Claude engine (the Claude Agent SDK) to a newer release.
  Reads what changed between the pins, bumps the exact pin and lockfile, and
  proves the new engine on the hermetic suites, the slim artifact, a first-turn
  download, one live approval turn and the conformance arms. Invoke by name when
  asked to upgrade or bump the Claude engine.
disable-model-invocation: true
---

# Upgrade the Claude engine

The runner runs Anthropic's Claude Agent SDK as a program of its own, pinned to
one exact version. The pin lives in two manifests and one lockfile, all in
`backend/services/runner`:

- `package.json`: the peer dependency and the dev dependency on
  `@anthropic-ai/claude-agent-sdk`, both exact;
- `package-lock.json`: the SDK and one platform package per machine, each with
  its URL and integrity.

Everything else follows the lockfile.
`backend/services/runner/scripts/claude-engine-pin.mjs` reads it,
`bundle-slim.mjs` writes `claude-engine.json` beside the slim entry from it,
every image's engine layer installs from it, and a local runner downloads
exactly those bytes on its first Claude turn
(`backend/services/runner/src/activities/execute-claude/engine-fetch.ts`).

Anthropic publishes a new release most days. A bump is its own pull request,
never part of other work: branch `chore/claude-engine-<version>` (dots as
dashes), one version per PR. Each step below quotes its output into the PR body.
A step that stops, stops the bump: say what changed and bring it to the
maintainer before any workaround.

## 1. Read what changed between the pins

```bash
cd backend/services/runner
OLD=$(node -p "require('./package.json').devDependencies['@anthropic-ai/claude-agent-sdk']")
npm view @anthropic-ai/claude-agent-sdk version time --json | tail -20   # the newest release, and when
NEW=<the newest release>
```

Take the newest release, not a number a plan wrote down. Then read three things
between `OLD` and `NEW`:

- **Claude Code's changelog** (github.com/anthropics/claude-code,
  `CHANGELOG.md`), for every Claude Code version the SDK releases between the
  two carry (`npm view @anthropic-ai/claude-agent-sdk@$NEW claudeCodeVersion`).
- **The SDK's types.** Unpack both tarballs into scratch directories and diff
  every declaration file, not `sdk.d.ts` alone: the tools' input and output
  shapes are in `sdk-tools.d.ts`.

  ```bash
  for v in $OLD $NEW; do mkdir -p /tmp/sdk-$v && (cd /tmp/sdk-$v && npm pack @anthropic-ai/claude-agent-sdk@$v >/dev/null && tar xzf *.tgz); done
  for f in $(cd /tmp/sdk-$NEW/package && ls *.d.ts); do diff -u /tmp/sdk-$OLD/package/$f /tmp/sdk-$NEW/package/$f; done
  ```

- **The hooks reference's defer section** (code.claude.com/docs/en/hooks.md,
  "Defer a tool call for later"): the pause every approval rides on.

Stop on any of these:

- a built-in tool removed or renamed that the runner names (`engine-options.ts`,
  `@stigmer/tool-vocabulary`);
- a `PreToolUse` decision whose meaning changed (`defer`, `allow`, `deny`,
  `ask`), or a deferred call's result shape (`deferred_tool_use`);
- a changed session option: `sessionStore`, `sessionStoreFlush`, `resume`,
  `sessionId`, `persistSession`, `loadTimeoutMs`;
- a changed environment variable the engine reads from `engine-env.ts`.

## 2. Bump the pin

Edit both manifest entries, the peer dependency and the dev dependency, to `NEW`
exactly (no range) by hand, then let npm write the lockfile and install it:

```bash
npm install --package-lock-only && npm ci
node --input-type=module -e "const {claudeEnginePinFromLockfile}=await import('./scripts/claude-engine-pin.mjs'); const p=claudeEnginePinFromLockfile('package-lock.json'); console.log(p.version, Object.keys(p.packages).length)"
git diff --stat
```

The node command prints the new version and the package count: the SDK and its
platform packages. The diff is the two manifest lines and the SDK's lockfile
entries, nothing else. Do not use
`npm install --save-exact --save-dev <sdk>@$NEW`: it rewrites the whole
manifest, unescaping its strings and re-sorting its dependencies. No other file
names the version: the "measured on SDK <version>" comments are claims the
suites re-check, not text to bump (step 3 says when one changes).

## 3. The hermetic suites, on the real engine

```bash
npx vitest run src/activities/execute-claude src/__tests__/approval-gateway-contract.test.ts
```

Every hermetic golden is the engine's own stream through the translator, so a
new engine can move one. Run the failing file with `-u` only after reading its
diff, and explain every hunk in the PR body: which engine change made it, and
why the new rows are right. When the translator's header says the new rows are
wrong (an engine frame reaching a row that promises the sub-agent's own answer,
say), fix the translator so the golden holds, with a unit case, and name the
engine change it answers. A hunk with no explanation is a stop. Where a hunk
shows that a fact a comment records "measured on SDK <version>" has changed,
update that comment to the new fact and version in the same commit.

## 4. The pin the artifacts carry

```bash
npx vitest run src/activities/execute-claude/__tests__/engine-pin-tarballs.test.ts
cd ../../.. && make build-runner-slim && (cd backend/services/runner && npm run verify:slim)
```

`engine-pin-tarballs` packs the real tarballs at the new pin. `verify:slim` is
check 4b: `claude-engine.json` beside the entry equals the lockfile. Its boots
need a Temporal dev server (`temporal server start-dev --headless`; on another
port, `TEMPORAL_SERVICE_ADDRESS=127.0.0.1:<port>`). Check 4c (the engine an
image carries runs) needs an image; the dev build in step 8 runs it in its image
smoke.

## 5. A local runner's first turn downloads the new pin

This is the path the desktop app and `stigmer up` take: no engine in the
runner's install, an empty engines root, and the first Claude turn fetching the
pin. Copy the slim artifact out of the checkout, so it cannot fall back to the
checkout's own install, and run the e2e Claude approval spec on it:

```bash
STAGED=$(mktemp -d) && cp -R backend/services/runner/dist-slim/. "$STAGED/"
export STIGMER_ENGINES_DIR=$(mktemp -d)
cd test/e2e && STIGMER_E2E_MOCK_LLM=1 STIGMER_E2E_RUNNER_ENTRY="$STAGED/main.js" \
  npx playwright test --project=interactive-approval --workers=1 tests/interactive-approval/session-claude-flow.spec.ts
ls "$STIGMER_ENGINES_DIR/claude"
```

The spec passes, and the engines root holds exactly one home, named `NEW`.

## 6. One live approval turn

```bash
cd backend/services/runner
STIGMER_LIVE=1 ANTHROPIC_API_KEY=<a test key> npm run test:live -- src/activities/execute-claude/__tests__/claude-approval.live.test.ts
```

One Claude Haiku turn whose shell call waits for a person, is approved, and runs
exactly once, on Anthropic itself, under a cap of $0.10. Use a key kept for
tests, never an organization's. Quote the spend line (`[live] spend …`).

## 7. The execution conformance suite's Claude arms

```bash
npm run test:execution -w @stigmer/conformance -- -t "on Claude"
```

They need the `temporal` CLI and the `stigmer` CLI on `PATH`, as the execution
lane does (`test/conformance/README.md`). Then run every lane
`node scripts/ci-lanes.mjs --base origin/main` prints for the diff.

## 8. The pull request, then the dev build

Open the PR with `.agents/skills/create-stigmer-oss-pull-request/SKILL.md`, its
body carrying each step's output and every golden hunk's explanation. Once it
merges, a dev build of `main` publishes the runner and its images at the new
pin:

```bash
gh workflow run release.dev.yaml --ref main -f targets=npm
```

The image smoke in that run executes check 4c on the published image. A
composition that pins `@stigmer/*` moves to that dev build on its own procedure.
