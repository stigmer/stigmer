/**
 * The compose stack as an install a script can bring up, move to another
 * release, and take down: the one place that knows how this repository's
 * docker-compose.yml is started, shared by the compose smoke
 * (scripts/smoke-compose.mjs) and the upgrade rehearsal
 * (scripts/rehearse-upgrade.mjs), so the two can never boot it differently.
 * It also owns the source build of the two images, which the Helm smoke loads
 * into kind: one build path for every source-built install.
 *
 * A stack is configured the way the self-hosting guide tells a user to: one
 * env file (fresh keys, STIGMER_VERSION for a published release, the model's
 * ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL, and STIGMER_PUBLIC_URL, the
 * address clients reach the stack on), the compose file, and, for a
 * source build, docker-compose.dev.yml on top. One override file maps
 * host.docker.internal into the runner so it can reach a model on this host,
 * and, for a compose file older than its ANTHROPIC_BASE_URL line (v3.41.0
 * and before), hands the runner that variable itself. Nothing
 * test-only lands in the tree. The env file is passed with --env-file, so a
 * developer's own .env is never read.
 *
 * An upgrade is the guide's: the release's compose file in place of the old
 * one (`git pull`), STIGMER_VERSION moved, then `docker compose pull` and
 * `up -d` under the same project, whose named volumes carry the data.
 *
 * Plain node and the docker CLI, no dependencies, like its neighbours.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");
const runnerCliStage = join(repoRoot, "backend", "services", "runner", "stage", "cli");

/** The compose file of this checkout: what `git pull` gives a user who is on it. */
export const CHECKOUT_COMPOSE_FILE = join(repoRoot, "docker-compose.yml");
const DEV_OVERLAY_FILE = join(repoRoot, "docker-compose.dev.yml");

/** The product's fixed host ports, published by docker-compose.yml. */
export const COMPOSE_SERVER_PORT = 7234;
export const COMPOSE_ARTIFACT_PORT = 7235;

/**
 * The STIGMER_PUBLIC_URL a stack is configured with: the address the scripts
 * reach it on, so every link the server mints still answers, and not the
 * compose file's own default (http://localhost:7234), so a stack that loses
 * the variable on its way to the server mints the default and shows it.
 */
export const COMPOSE_PUBLIC_URL = `http://127.0.0.1:${COMPOSE_SERVER_PORT}`;

/** The tags docker-compose.dev.yml gives the two source-built images. */
export const SOURCE_IMAGES = Object.freeze({
  server: "stigmer-server:compose-dev",
  runner: "stigmer-runner:compose-dev",
});

/**
 * The dev server image COPYs dist-slim-<arch>/; stage it from the dist-slim
 * tree bundle-slim.mjs produced for THIS machine (the smoke-docker-image.mjs
 * staging contract).
 */
export function stageServerTree(log) {
  const distSlim = join(serverRoot, "dist-slim");
  if (!existsSync(join(distSlim, "main.js"))) {
    throw new Error(
      "dist-slim/main.js not found — build it first:\n" +
        "  make build-server build-web && " +
        "cd backend/services/stigmer-server && node scripts/bundle-slim.mjs",
    );
  }
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (arch === "") throw new Error(`unsupported host arch "${process.arch}"`);
  const staged = join(serverRoot, `dist-slim-${arch}`);
  log(`staging dist-slim/ -> dist-slim-${arch}/`);
  rmSync(staged, { recursive: true, force: true });
  cpSync(distSlim, staged, { recursive: true });
}

/**
 * The dev runner image installs the CLI tarballs staged under
 * backend/services/runner/stage/cli (scripts/stage-compose-runner-cli.mjs)
 * and asserts their version against the STIGMER_CLI_VERSION build-arg, which
 * docker-compose.dev.yml requires.
 */
export function stagedRunnerCliVersion() {
  const versionFile = join(runnerCliStage, "VERSION");
  if (!existsSync(versionFile)) {
    throw new Error(
      "backend/services/runner/stage/cli is not staged — run `make stage-compose-runner-cli` " +
        "(or `node scripts/stage-compose-runner-cli.mjs`) first",
    );
  }
  return readFileSync(versionFile, "utf8").trim();
}

/**
 * Both images from source through docker-compose.dev.yml, tagged
 * {@link SOURCE_IMAGES}. The build needs no stack: the three required keys
 * are placeholders, and only the staged CLI's version is a real build input.
 */
export function buildSourceImages({ log }) {
  stageServerTree(log);
  log("docker compose build (server + runner from source)");
  execFileSync("docker", ["compose", "-f", CHECKOUT_COMPOSE_FILE, "-f", DEV_OVERLAY_FILE, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      POSTGRES_PASSWORD: "unused",
      STIGMER_ENCRYPTION_KEY: "unused",
      STIGMER_RUNNER_TOKEN_KEY: "unused",
      STIGMER_CLI_VERSION: stagedRunnerCliVersion(),
    },
  });
  return SOURCE_IMAGES;
}

/**
 * The compose file a release shipped, written into `dir`: what a user's clone
 * at that tag holds. A shallow checkout carries no tags, so the tag is
 * fetched first when it is not already here.
 */
export function composeFileAtRelease(version, dir) {
  const tag = `v${version}`;
  const known = spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], { cwd: repoRoot });
  if (known.status !== 0) {
    execFileSync("git", ["fetch", "--quiet", "--depth=1", "origin", "tag", tag], { cwd: repoRoot, stdio: "inherit" });
  }
  const file = join(dir, `docker-compose.${tag}.yml`);
  writeFileSync(file, execFileSync("git", ["show", `${tag}:docker-compose.yml`], { cwd: repoRoot, encoding: "utf8" }));
  return file;
}

/**
 * The env file a stack runs with, as text: the same keys on every write, so
 * an upgrade keeps the database password and the encryption keys; the public
 * address; the published version or the staged CLI version the release
 * needs; the model.
 */
export function composeEnvText({ keys, publicUrl, release, runnerCliVersion, model }) {
  const lines = [
    `POSTGRES_PASSWORD=${keys.postgresPassword}`,
    `STIGMER_ENCRYPTION_KEY=${keys.encryptionKey}`,
    `STIGMER_RUNNER_TOKEN_KEY=${keys.runnerTokenKey}`,
    `STIGMER_PUBLIC_URL=${publicUrl}`,
  ];
  if (release.kind === "published") lines.push(`STIGMER_VERSION=v${release.version}`);
  else lines.push(`STIGMER_CLI_VERSION=${runnerCliVersion}`);
  lines.push(`ANTHROPIC_API_KEY=${model.ANTHROPIC_API_KEY}`, `ANTHROPIC_BASE_URL=${model.ANTHROPIC_BASE_URL}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The override file beside a compose file: host.docker.internal mapped into
 * the runner, and the model's address handed to the runner directly when the
 * compose file itself does not pass ANTHROPIC_BASE_URL through (a release
 * from before that line; its runner still reads the variable, through the
 * Anthropic SDK's own environment default).
 */
export function composeOverrideText(composeFileText, model) {
  const lines = [
    "services:",
    "  stigmer-runner:",
    "    extra_hosts:",
    '      - "host.docker.internal:host-gateway"',
  ];
  if (!/\bANTHROPIC_BASE_URL\b/.test(composeFileText)) {
    lines.push("    environment:", `      ANTHROPIC_BASE_URL: ${JSON.stringify(model.ANTHROPIC_BASE_URL)}`);
  }
  return `${lines.join("\n")}\n`;
}

function freshKeys() {
  return {
    postgresPassword: randomBytes(24).toString("hex"),
    encryptionKey: randomBytes(32).toString("base64"),
    runnerTokenKey: randomBytes(32).toString("base64"),
  };
}

/**
 * A compose stack configured with `model` (the ANTHROPIC_API_KEY and
 * ANTHROPIC_BASE_URL a user sets). Nothing runs until `start`, so a caller
 * holds the stack, and can print its diagnostics and stop it, however far a
 * start got. Waiting for SERVING after `start` or `upgrade` is the caller's,
 * as it is a user's.
 */
export function createComposeStack({ model, log }) {
  const workDir = mkdtempSync(join(tmpdir(), "stigmer-compose-"));
  const envFile = join(workDir, "stack.env");
  const overrideFile = join(workDir, "host-gateway.yml");
  const project = `stigmer-smoke-${Date.now()}`;
  const keys = freshKeys();
  let files = [];

  const configure = (target, file) => {
    const runnerCliVersion = target.kind === "build" ? stagedRunnerCliVersion() : "";
    writeFileSync(envFile, composeEnvText({ keys, publicUrl: COMPOSE_PUBLIC_URL, release: target, runnerCliVersion, model }));
    writeFileSync(overrideFile, composeOverrideText(readFileSync(file, "utf8"), model));
    // The first file is the project directory, so after a swap to this
    // checkout's file the dev overlay's build contexts resolve against it.
    files = [file, ...(target.kind === "build" ? [DEV_OVERLAY_FILE] : []), overrideFile];
  };
  const composeArgs = () => ["compose", "-p", project, "--env-file", envFile, ...files.flatMap((file) => ["-f", file])];
  const compose = (args, options = {}) =>
    execFileSync("docker", [...composeArgs(), ...args], { cwd: repoRoot, encoding: "utf8", ...options });

  // Starting and upgrading are the same act in compose: the release's file
  // and version in place, then pull and up -d under the one project.
  const bringUp = (target, file) => {
    if (target.kind === "build") buildSourceImages({ log });
    configure(target, file);
    if (target.kind === "published") {
      log(`pulling published images at v${target.version}`);
      compose(["pull", "--quiet", "stigmer-server", "stigmer-runner"], { stdio: "inherit" });
    }
    log("docker compose up -d");
    compose(["up", "-d"], { stdio: "inherit" });
  };

  return {
    project,
    baseUrl: `http://127.0.0.1:${COMPOSE_SERVER_PORT}`,
    artifactUrl: `http://127.0.0.1:${COMPOSE_ARTIFACT_PORT}`,
    workDir,
    /**
     * Bring the stack up at `release` ({ kind: "build" } or { kind:
     * "published", version: "3.41.0" }) from `composeFile`.
     */
    async start(release, { composeFile = CHECKOUT_COMPOSE_FILE } = {}) {
      bringUp(release, composeFile);
    },
    /** The guide's upgrade: the target's compose file, the version moved, pull, up -d. */
    async upgrade(target, { composeFile = CHECKOUT_COMPOSE_FILE } = {}) {
      bringUp(target, composeFile);
    },
    /** One service's log as compose prints it, without the service prefix: what `docker compose logs` shows a user. */
    logs(service) {
      return compose(["logs", "--no-log-prefix", "--no-color", service]);
    },
    /** The image each running service was created from, by service name. */
    async images() {
      return serviceImages(compose(["ps", "--format", "json"]));
    },
    diagnostics() {
      if (files.length === 0) return "--- the stack was never configured ---";
      const ps = spawnSync("docker", [...composeArgs(), "ps"], { encoding: "utf8" });
      const logs = spawnSync("docker", [...composeArgs(), "logs", "--tail", "120"], { encoding: "utf8" });
      return [
        "--- docker compose ps ---",
        ps.stdout ?? "",
        "--- docker compose logs (last 120 lines/service) ---",
        logs.stdout ?? "",
        logs.stderr ?? "",
      ].join("\n");
    },
    /** `down --volumes` and the work directory removed; `keep` leaves both for debugging. */
    async stop({ keep = false } = {}) {
      if (keep) {
        log(`--keep: stack left running (project ${project}; env file ${envFile})`);
        return;
      }
      if (files.length > 0) {
        spawnSync("docker", [...composeArgs(), "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
      }
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

/**
 * `docker compose ps --format json` as { service: image }. Compose prints one
 * JSON object per line since v2.21 and one array before it; both are read.
 */
export function serviceImages(psJson) {
  const text = psJson.trim();
  if (text === "") return {};
  const rows = text.startsWith("[") ? JSON.parse(text) : text.split("\n").map((line) => JSON.parse(line));
  return Object.fromEntries(rows.map((row) => [row.Service, row.Image]));
}
