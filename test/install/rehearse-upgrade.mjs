#!/usr/bin/env node

/**
 * The upgrade rehearsal: one packaged install moved from a published release
 * to the candidate by the procedure its guide gives a user, and proven to
 * have kept what the old release stored.
 *
 * For --artifact=compose, all-in-one, helm or cli, one pass:
 *   1. installs --from (default: the newest stable release below --to whose
 *      artifacts for this install are all published,
 *      test/install/lib/published-release.mjs) the way its guide says, with the
 *      model a user configures pointed at the fake on this host
 *      (test/install/lib/fake-model.mjs), and checks that the
 *      server reports that release (getServerInfo);
 *   2. records state: a workflow run, and an agent run answered by the
 *      model, each in an organization of its own, every resource read back;
 *   3. upgrades to --to exactly as the guide says:
 *        compose     the release's docker-compose.yml, STIGMER_VERSION moved,
 *                    `docker compose pull`, `up -d` (operations.mdx)
 *        all-in-one  stop and remove the container, the new tag on the same
 *                    volume (all-in-one.mdx)
 *        helm        `helm upgrade` to the new chart with the same values,
 *                    --wait, a new port-forward (operations.mdx)
 *        cli         `stigmer down`, the new CLI, `stigmer up` on the same
 *                    home (docs/cli/index.mdx)
 *      and checks that the server now reports --to, and that the new images
 *      (or the CLI's runtime) are the ones running;
 *   4. reads every recorded resource back and compares it field by field:
 *      nothing lost, nothing renamed, both runs still COMPLETED, the agent's
 *      reply intact, the agent still found by its org/slug reference;
 *   5. runs the agent the old release stored, then a fresh agent in the
 *      organization the old release made, each to the model's reply;
 *   6. tears the install down, also on failure, with its diagnostics printed.
 *
 * --to=build (the default) is this checkout built from source, stamped with
 * its from-source version (scripts/lib/source-version.mjs), so step 3's
 * version check is an equality; `make rehearse-upgrade ARTIFACT=<a>` builds
 * and stamps it. --to=<X.Y.Z> is a published release, which is how the
 * release rehearses the version it just pushed before `:latest` moves; a
 * prerelease (X.Y.Z-rc.1) is one too, rehearsed from the newest stable
 * release below its X.Y.Z, since the release publishes its chart as well.
 * --chart=<dir|.tgz> (helm, a published --to only) upgrades to that chart
 * with the release's images: the release's packaged chart, before it is
 * pushed. The base is always installed from the published chart.
 *
 * Each install is brought up by the same driver its smoke uses
 * (test/install/lib/install-*.mjs), so the rehearsal and the smoke can never boot
 * an artifact differently.
 *
 * Usage:
 *   node test/install/rehearse-upgrade.mjs --artifact=<compose|all-in-one|helm|cli>
 *       [--from=X.Y.Z] [--to=build|X.Y.Z[-pre]] [--chart=<dir|.tgz>] [--keep]
 *
 *   --keep   leave the upgraded install running for debugging (the fake
 *            model stops with this process, so agent runs then fail).
 *
 * compose, helm and cli bind the product's port 7234 and refuse to start if
 * it is taken; all-in-one publishes random loopback ports.
 *
 * Plain node plus the tools each artifact needs (docker; kind, helm and
 * kubectl for helm; npm for the release list), no dependencies.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { fakeModelEnv, startFakeModel } from "./lib/fake-model.mjs";
import { allInOneImage, createAllInOne } from "./lib/install-all-in-one.mjs";
import { createCliInstall } from "./lib/install-cli.mjs";
import {
  CHECKOUT_COMPOSE_FILE,
  COMPOSE_ARTIFACT_PORT,
  COMPOSE_SERVER_PORT,
  SOURCE_IMAGES,
  composeFileAtRelease,
  createComposeStack,
} from "./lib/install-compose.mjs";
import {
  HELM_ARTIFACT_PORT,
  HELM_SERVER_PORT,
  chartFor,
  createKindCluster,
  createStigmerRelease,
  profileValues,
} from "./lib/install-helm.mjs";
import { PUBLISHED_IMAGES, unpublishedArtifact } from "./lib/published-release.mjs";
import { sourceBuildVersion } from "../../scripts/lib/source-version.mjs";
import {
  assertPortFree,
  assertStateSurvived,
  recordState,
  runAgentExecution,
  runAgentToReply,
  serverVersion,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const ARTIFACTS = ["compose", "all-in-one", "helm", "cli"];
const SERVING_TIMEOUT_MS = 300_000;
const RUN_TIMEOUT_MS = 240_000;
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
/** A release a rehearsal can move to: a stable version or a prerelease of one. */
const RELEASE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

function log(step) {
  console.log(`rehearse-upgrade: ${step}`);
}

/**
 * The command line as `{ artifact, from, to, chart, keep }`: `to` is { kind:
 * "build" } or { kind: "published", version }, `from` a version or "" (pick
 * the newest release below `to`), `chart` the target chart or undefined.
 * Throws on anything else.
 */
export function parseRehearsalArgs(argv) {
  const parsed = { artifact: "", from: "", to: { kind: "build" }, chart: undefined, keep: false };
  for (const arg of argv) {
    let m;
    if ((m = arg.match(/^--artifact=(.+)$/)) !== null) parsed.artifact = m[1];
    else if ((m = arg.match(/^--from=v?(.+)$/)) !== null) parsed.from = m[1];
    else if ((m = arg.match(/^--to=v?(.+)$/)) !== null) {
      parsed.to = m[1] === "build" ? { kind: "build" } : { kind: "published", version: m[1] };
    } else if ((m = arg.match(/^--chart=(.+)$/)) !== null) parsed.chart = m[1];
    else if (arg === "--keep") parsed.keep = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!ARTIFACTS.includes(parsed.artifact)) {
    throw new Error(`--artifact must be one of: ${ARTIFACTS.join(", ")} (got ${JSON.stringify(parsed.artifact)})`);
  }
  if (parsed.from !== "" && !STABLE.test(parsed.from)) throw new Error(`--from must be a release X.Y.Z (got ${parsed.from})`);
  if (parsed.to.kind === "published" && !RELEASE.test(parsed.to.version)) {
    throw new Error(`--to must be build or a release X.Y.Z or X.Y.Z-<pre> (got ${parsed.to.version})`);
  }
  if (parsed.from !== "" && parsed.to.kind === "published" && compareVersions(parsed.from, versionCore(parsed.to.version)) >= 0) {
    throw new Error(`--from ${parsed.from} is not below --to ${parsed.to.version}: an upgrade only moves forward`);
  }
  if (parsed.chart !== undefined && (parsed.artifact !== "helm" || parsed.to.kind !== "published")) {
    throw new Error("--chart applies only to --artifact=helm with a published --to (the release's packaged chart)");
  }
  return parsed;
}

/** A release's X.Y.Z: a prerelease's version without its `-<pre>` part. */
export function versionCore(version) {
  return version.replace(/-.*$/, "");
}

/** Numeric order of two X.Y.Z versions. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The release an upgrade to `to` starts from: the greatest stable version in
 * `versions` below it (every stable version when `to` is a build; below its
 * X.Y.Z when `to` is a prerelease, so 3.42.0-rc.1 starts from 3.41.x).
 * Prereleases (a `-dev.` build published for testing) are never a base. It is
 * not npm's `latest` tag: in the release lane `latest` may already be the
 * version being rehearsed.
 */
export function pickFromVersion(versions, to) {
  return releasesBelow(versions, to)[0];
}

/** Every stable version in `versions` below `to`, newest first; refuses when there is none. */
function releasesBelow(versions, to) {
  const below = versions
    .filter((version) => STABLE.test(version))
    .filter((version) => to.kind === "build" || compareVersions(version, versionCore(to.version)) < 0)
    .sort(compareVersions)
    .reverse();
  if (below.length === 0) {
    throw new Error(`no published release below ${to.kind === "build" ? "this build" : to.version} to upgrade from`);
  }
  return below;
}

/**
 * The base an install upgrades from when --from is not given: the newest
 * release `pickFromVersion` would choose whose own artifacts are all
 * published (`unpublishedAt(version)` names the first that is not, or is
 * undefined). npm lists a release before its images and its chart are
 * pushed, and a held push never arrives, so a newer release is passed over,
 * and named, rather than installed half-published.
 */
export async function pickPublishedBase(versions, to, unpublishedAt, log) {
  const below = releasesBelow(versions, to);
  for (const version of below) {
    const missing = await unpublishedAt(version);
    if (missing === undefined) return version;
    log(`base ${version} passed over: ${missing} is not published`);
  }
  throw new Error(
    `no release below ${to.kind === "build" ? "this build" : to.version} has every artifact this install needs published ` +
      `(tried ${below.join(", ")})`,
  );
}

/** The version the server must report once `release` runs. */
export function expectedServerVersion(release) {
  return release.kind === "published" ? release.version : sourceBuildVersion();
}

function describe(release) {
  return release.kind === "published" ? release.version : `this checkout (${sourceBuildVersion()})`;
}

function publishedCliVersions() {
  return JSON.parse(execFileSync("npm", ["view", "@stigmer/cli", "versions", "--json"], { encoding: "utf8" }));
}

/**
 * Each artifact behind one shape: `start(release)` and `upgrade(release)`
 * resolve once the install's API answers SERVING, `baseUrl()` is where it
 * answers, `images(release)` checks that what runs is that release's, and
 * `diagnostics()` / `stop()` as their drivers define them.
 */
const INSTALLS = {
  compose: {
    ports: [COMPOSE_SERVER_PORT, COMPOSE_ARTIFACT_PORT],
    create(fake) {
      const stack = createComposeStack({ model: fakeModelEnv(fake, "host.docker.internal"), log });
      // A published release runs from its own compose file, as a clone at its tag holds.
      const composeFile = (release) =>
        release.kind === "published" ? composeFileAtRelease(release.version, stack.workDir) : CHECKOUT_COMPOSE_FILE;
      return {
        baseUrl: () => stack.baseUrl,
        start: (release) => stack.start(release, { composeFile: composeFile(release) }),
        upgrade: (release) => stack.upgrade(release, { composeFile: composeFile(release) }),
        async images(release) {
          const running = await stack.images();
          const want =
            release.kind === "build"
              ? { "stigmer-server": SOURCE_IMAGES.server, "stigmer-runner": SOURCE_IMAGES.runner }
              : {
                  "stigmer-server": `${PUBLISHED_IMAGES.server}:v${release.version}`,
                  "stigmer-runner": `${PUBLISHED_IMAGES.runner}:v${release.version}`,
                };
          return { running, want };
        },
        diagnostics: () => stack.diagnostics(),
        stop: ({ keep }) => stack.stop({ keep }),
      };
    },
  },
  "all-in-one": {
    ports: [],
    create(fake) {
      const aio = createAllInOne({ model: fakeModelEnv(fake, "host.docker.internal"), log });
      let image = "";
      return {
        baseUrl: () => aio.baseUrl(),
        async start(release) {
          image = allInOneImage(release, log);
          await aio.start(image);
          await aio.waitHealthy();
        },
        async upgrade(release) {
          image = allInOneImage(release, log);
          await aio.upgrade(image);
          await aio.waitHealthy();
        },
        async images() {
          return { running: await aio.images(), want: { "all-in-one": image } };
        },
        diagnostics: () => aio.diagnostics(),
        async stop({ keep }) {
          if (keep) log(`--keep: container ${aio.container} left running (volume ${aio.volume})`);
          else await aio.stop();
        },
      };
    },
  },
  helm: {
    ports: [HELM_SERVER_PORT, HELM_ARTIFACT_PORT],
    create(fake, { chart }) {
      const cluster = createKindCluster({ log });
      let release;
      let forward;
      const connectForward = async () => {
        forward = await release.portForward();
      };
      // The base always comes from the published chart; only the target may
      // be the release's packaged chart.
      const chartSpec = (target, options = {}) => {
        if (target.kind === "build") cluster.loadSourceImages();
        return chartFor(target, options);
      };
      return {
        baseUrl: () => forward.baseUrl,
        async start(target) {
          await cluster.start();
          const modelBaseUrl = fakeModelEnv(fake, cluster.hostAddress()).ANTHROPIC_BASE_URL;
          // The guide's namespace and the default profile: the chart's own
          // Postgres and Temporal, which is what a user gets.
          release = createStigmerRelease(cluster, {
            namespace: "stigmer",
            valuesFile: profileValues("bundled"),
            modelBaseUrl,
            postgresPassword: randomBytes(24).toString("hex"),
            log,
          });
          release.createSecrets();
          log(`helm install stigmer (${describe(target)})`);
          await release.install(chartSpec(target));
          await connectForward();
        },
        async upgrade(target) {
          forward.stop();
          log(`helm upgrade stigmer (${describe(target)}), same values, --wait`);
          await release.upgrade(chartSpec(target, { chart }));
          await connectForward();
        },
        async images(target) {
          const tag = target.kind === "build" ? "compose-dev" : `v${target.version}`;
          return {
            running: await release.images(),
            want: { server: `${PUBLISHED_IMAGES.server}:${tag}`, runner: `${PUBLISHED_IMAGES.runner}:${tag}` },
          };
        },
        diagnostics: () => (release === undefined ? "--- no release was installed ---" : release.diagnostics()),
        async stop({ keep }) {
          forward?.stop();
          await cluster.stop({ keep });
        },
      };
    },
  },
  cli: {
    ports: [7234],
    create(fake) {
      const stack = createCliInstall({ model: fakeModelEnv(fake), log });
      return {
        baseUrl: () => stack.baseUrl,
        start: (release) => stack.start(release),
        upgrade: (release) => stack.upgrade(release),
        async images(release) {
          const running = await stack.images();
          // The daemon's server entry: the acquired runtime of that CLI
          // version, or the checkout's staged server package.
          const marker = release.kind === "published" ? `/runtimes/${release.version}/` : "/server-pkg/";
          return { running, want: { server: marker }, contains: true };
        },
        diagnostics: () => stack.diagnostics(),
        async stop({ keep }) {
          if (keep) log(`--keep: the stack left running (HOME=${stack.home})`);
          else await stack.stop();
        },
      };
    },
  },
};

/** Every entry of `want` must be what runs (or, with `contains`, appear in it). */
export function imageMismatches({ running, want, contains = false }) {
  return Object.entries(want)
    .filter(([name, expected]) => (contains ? !(running[name] ?? "").includes(expected) : running[name] !== expected))
    .map(([name, expected]) => `${name}: running ${JSON.stringify(running[name] ?? null)}, want ${JSON.stringify(expected)}`);
}

async function assertRunning(install, release, phase) {
  const baseUrl = install.baseUrl();
  await waitForServing(baseUrl, SERVING_TIMEOUT_MS);
  const version = await serverVersion(baseUrl);
  const want = expectedServerVersion(release);
  if (version !== want) {
    throw new Error(`${phase}: the server reports ${version}, want ${want}`);
  }
  const images = await install.images(release);
  const mismatches = imageMismatches(images);
  if (mismatches.length > 0) throw new Error(`${phase}: not the release's images: ${mismatches.join("; ")}`);
  log(`${phase}: SERVING, the server reports ${version}; running ${JSON.stringify(images.running)}`);
  return version;
}

async function main() {
  let args;
  try {
    args = parseRehearsalArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`rehearse-upgrade: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const to = args.to;
  const spec = INSTALLS[args.artifact];
  // Before anything starts, so a refusal is this script's FAIL line and
  // there is nothing to tear down.
  let from;
  try {
    const base =
      args.from !== ""
        ? args.from
        : await pickPublishedBase(publishedCliVersions(), to, (version) => unpublishedArtifact(args.artifact, version), log);
    from = { kind: "published", version: base };
    for (const port of spec.ports) await assertPortFree(port);
  } catch (error) {
    console.error(`rehearse-upgrade: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  log(`${args.artifact}: ${describe(from)} -> ${describe(to)}${args.chart === undefined ? "" : ` (chart ${args.chart})`}`);

  const started = Date.now();
  const lap = (() => {
    let last = started;
    return () => {
      const now = Date.now();
      const seconds = Math.round((now - last) / 1000);
      last = now;
      return `${seconds}s`;
    };
  })();

  const fake = await startFakeModel({ host: args.artifact === "cli" ? "127.0.0.1" : "0.0.0.0" });
  const install = spec.create(fake, { chart: args.chart });
  let failed = false;
  try {
    await install.start(from);
    const before = await assertRunning(install, from, "base");
    log(`base installed (${lap()})`);

    const recorded = await recordState(install.baseUrl(), RUN_TIMEOUT_MS, { expectText: fake.replyText, log });
    log(`state recorded: ${JSON.stringify(recorded.ids)} (${lap()})`);

    await install.upgrade(to);
    const after = await assertRunning(install, to, "upgraded");
    log(`upgraded ${before} -> ${after} (${lap()})`);

    const baseUrl = install.baseUrl();
    await assertStateSurvived(baseUrl, recorded);
    log(`read back unchanged: ${Object.keys(recorded.snapshot).join(", ")}; the old reply: ${recorded.snapshot.agentExecution.reply}`);
    const oldAgent = await runAgentExecution(
      baseUrl,
      { orgId: recorded.ids.agentOrgId, agentId: recorded.ids.agentId },
      RUN_TIMEOUT_MS,
      { expectText: fake.replyText, log },
    );
    log(`the agent ${before} stored ran on ${after}: execution ${oldAgent.executionId} replied`);
    // In the organization the base release made: a release before the server
    // held one organization made one per line, and the upgraded server, which
    // holds one, admits no other — so the fresh agent names one it keeps.
    const fresh = await runAgentToReply(baseUrl, RUN_TIMEOUT_MS, {
      expectText: fake.replyText,
      log,
      org: recorded.ids.agentOrgId,
    });
    log(`a fresh agent on ${after}: execution ${fresh.executionId} replied (${lap()})`);
    log(`PASS: ${args.artifact} ${before} -> ${after} in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    failed = true;
    console.error(`rehearse-upgrade: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    console.error(install.diagnostics());
  } finally {
    await install.stop({ keep: args.keep && !failed });
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
