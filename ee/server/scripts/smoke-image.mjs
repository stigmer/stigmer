#!/usr/bin/env node

/**
 * Smokes the Stigmer Enterprise server image, stigmer-server-ee: the
 * open-source server image's Dockerfile over a tree bundled from this
 * package's entry (bundle-slim.mjs --entry-package). One script for the
 * three places the image is proven, as the server image's smoke is: `make
 * smoke-ee-image` on a laptop, the `ee` lane in every pull request, and the
 * release lane's native smokes of the pushed tag.
 *
 * What one run proves, in order:
 *   1. the image says whose it is: its title, description and license
 *      labels are Stigmer Enterprise's, which the release job sets as build
 *      arguments, so a drift between the two fails here;
 *   2. with no license key it is the open-source server exactly: the shared
 *      server image smoke (backend/services/stigmer-server/scripts/
 *      smoke-docker-image.mjs) runs against it whole, health, console, the
 *      one organization, edition `oss` and license `absent`, a round trip,
 *      a restart and a clean stop;
 *   3. a key it cannot verify refuses the boot: the container exits 1
 *      within the boot deadline, never reports healthy, and says why on one
 *      `boot failed: The Stigmer Enterprise license key ...` line. Two keys:
 *      a string in no key's form, and a well-formed key signed by an Ed25519
 *      key made here on the spot. The second is the promise that the image
 *      trusts only the keys compiled into it: a freshly minted key never
 *      verifies, whatever keys a release compiles in, so the smoke holds
 *      through every rotation and never needs a test key inside the image.
 *      It checks the refusal, not its kind (the verifier's own suite pins
 *      each sentence).
 *
 * Usage:
 *   node scripts/smoke-image.mjs [--image=TAG] [--database-url=URL]
 *
 *   Without --image: stages dist-slim/ (bundled for THIS machine's linux
 *   arch, `make bundle-ee-slim`) into dist-slim-<arch>/ and builds
 *   stigmer-server-ee:smoke-local with the Enterprise labels first.
 *   --database-url is handed to the no-key smoke (the shared smoke's flag);
 *   the bad-key boots run on SQLite, because the refusal comes before the
 *   server reads its database.
 *
 * Plain node + docker CLI, no dependencies, like the shared smoke.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(packageRoot, "..", "..", "backend", "services", "stigmer-server");

/** The labels the image carries; the release job passes the same three. */
const LABELS = {
  "org.opencontainers.image.title": "stigmer-server-ee",
  "org.opencontainers.image.description":
    "Stigmer Enterprise: the Stigmer control plane with many organizations, federation with other platforms, teams and invitations, turned on by a license key; unified gRPC/Connect/REST port with the bundled web console",
  "org.opencontainers.image.licenses": "LicenseRef-Stigmer-Enterprise AND Apache-2.0",
};

const LOCAL_TAG = "stigmer-server-ee:smoke-local";
// The shared smoke's boot deadline: a refusal is due long before it.
const BOOT_TIMEOUT_MS = 90_000;
const REFUSAL_LINE = "boot failed: The Stigmer Enterprise license key";

function parseArgs() {
  let image = "";
  let databaseUrl = "";
  for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = arg.match(/^--image=(.+)$/)) !== null) image = m[1];
    else if ((m = arg.match(/^--database-url=(.+)$/)) !== null) databaseUrl = m[1];
    else fail(`unknown argument: ${arg}`);
  }
  return { image, databaseUrl };
}

function fail(message) {
  console.error(`smoke-image: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-image: ${step}`);
}

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

/** node's arch names map straight onto docker's TARGETARCH for our two. */
function dockerArch() {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  fail(`unsupported host arch "${process.arch}"; the image ships amd64 and arm64 only`);
}

function buildLocalImage() {
  const distSlim = join(packageRoot, "dist-slim");
  if (!existsSync(join(distSlim, "main.js"))) {
    fail("dist-slim/main.js not found; bundle it first: make bundle-ee-slim");
  }
  const arch = dockerArch();
  const staged = join(packageRoot, `dist-slim-${arch}`);
  log(`staging dist-slim/ -> dist-slim-${arch}/ (the Dockerfile's TARGETARCH contract)`);
  rmSync(staged, { recursive: true, force: true });
  cpSync(distSlim, staged, { recursive: true });
  log(`docker build ${LOCAL_TAG} from the server's Dockerfile, context ee/server`);
  execFileSync(
    "docker",
    [
      "build",
      "--file",
      join(serverRoot, "Dockerfile"),
      "--build-arg",
      `IMAGE_TITLE=${LABELS["org.opencontainers.image.title"]}`,
      "--build-arg",
      `IMAGE_DESCRIPTION=${LABELS["org.opencontainers.image.description"]}`,
      "--build-arg",
      `IMAGE_LICENSES=${LABELS["org.opencontainers.image.licenses"]}`,
      "--tag",
      LOCAL_TAG,
      packageRoot,
    ],
    { stdio: "inherit" },
  );
  return LOCAL_TAG;
}

function assertLabels(image) {
  const labels = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Labels}}", image]));
  for (const [name, want] of Object.entries(LABELS)) {
    if (labels?.[name] !== want) {
      throw new Error(`label ${name} is ${JSON.stringify(labels?.[name])}; want ${JSON.stringify(want)}`);
    }
  }
  log(`labels: ${LABELS["org.opencontainers.image.title"]}, ${LABELS["org.opencontainers.image.licenses"]}`);
}

function assertBootsAsOpenSource(image, databaseUrl) {
  const args = [join(serverRoot, "scripts", "smoke-docker-image.mjs"), `--image=${image}`];
  if (databaseUrl !== "") args.push(`--database-url=${databaseUrl}`);
  log(`no key: the server image's smoke, whole (${databaseUrl !== "" ? "postgres" : "sqlite"} mode)`);
  const run = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`with no license key the image failed the open-source server's smoke (exit ${run.status})`);
  }
}

/** A key in the verifier's exact form, signed by a key pair nobody compiled in. */
function foreignKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = segment({ alg: "EdDSA", kid: `image-smoke-${randomUUID()}`, typ: "JWT" });
  const payload = segment({ iss: "stigmer-server-ee image smoke", sub: "a key no release trusts" });
  const signature = sign(null, Buffer.from(`${header}.${payload}`, "ascii"), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertRefuses(image, label, key) {
  const container = `stigmer-server-ee-smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    log(`${label}: docker run with STIGMER_LICENSE_KEY set (sqlite, no port published)`);
    docker(["run", "--detach", "--name", container, "-e", `STIGMER_LICENSE_KEY=${key}`, image]);
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let state = "";
    for (;;) {
      state = docker([
        "inspect",
        "--format",
        "{{.State.Status}} {{.State.ExitCode}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
        container,
      ]);
      if (state.endsWith(" healthy")) {
        throw new Error(`${label}: the container reported healthy; a key it cannot verify must refuse the boot`);
      }
      if (state.startsWith("exited ")) break;
      if (Date.now() > deadline) {
        throw new Error(`${label}: still ${state} after ${BOOT_TIMEOUT_MS}ms; a refusal exits before anything listens`);
      }
      await sleep(500);
    }
    const exitCode = state.split(" ")[1];
    if (exitCode !== "1") {
      throw new Error(`${label}: the container exited ${exitCode}; want 1`);
    }
    const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
    const lines = `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`.split("\n");
    const refusal = lines.find((line) => line.startsWith(REFUSAL_LINE));
    if (refusal === undefined) {
      throw new Error(
        `${label}: exit 1 without a "${REFUSAL_LINE} ..." line; the logs:\n${lines.slice(-40).join("\n")}`,
      );
    }
    log(`${label}: refused, exit 1: ${refusal}`);
  } finally {
    // --volumes: the image's VOLUME /data made an anonymous volume.
    spawnSync("docker", ["rm", "--force", "--volumes", container]);
  }
}

async function main() {
  const { image: imageArg, databaseUrl } = parseArgs();
  const image = imageArg !== "" ? imageArg : buildLocalImage();
  try {
    assertLabels(image);
    assertBootsAsOpenSource(image, databaseUrl);
    await assertRefuses(image, "a malformed key", "not-a-license-key");
    await assertRefuses(image, "a key signed by an untrusted key pair", foreignKey());
  } catch (error) {
    console.error(`smoke-image: FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  log("PASS");
}

await main();
