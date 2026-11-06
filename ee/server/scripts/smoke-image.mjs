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
 *   4. a license from Stigmer's issuer boots the image licensed, when one is
 *      handed to the run in STIGMER_EE_SMOKE_LICENSE_KEY: the container turns
 *      healthy on Postgres (its own `postgres:16` on a private network, or
 *      --database-url), logs "Stigmer Enterprise license verified" naming
 *      the license's own kid, answers getServerInfo with edition
 *      `enterprise`, and stops cleanly. Its sign-in issuer is
 *      `https://issuer.invalid`, a name that resolves nowhere, so the boot
 *      proves it dials no issuer. It runs no agent, so it accepts the shared
 *      runner (STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS) rather than
 *      compose a sandbox driver. The same license with one claim changed
 *      (the customer's name; the signature kept) is refused like step 3's
 *      keys, which shows that a trusted kid cannot carry altered claims.
 *      The license's state (current, or lapsed with the renewal warning) is
 *      logged and never asserted: a lapsed license keeps its edition, so
 *      the step proves the compiled key at every release with no renewals.
 *      getLicenseStatus is not read: it needs a signed-in caller, and the
 *      boot line names the kid it verified.
 *      The license comes from outside at run time and is passed to docker
 *      by name, never in argv. Without it the step is skipped, unless
 *      --require-license is given (the release lane gives it), which fails.
 *
 * Usage:
 *   node scripts/smoke-image.mjs [--image=TAG] [--database-url=URL] [--require-license]
 *   node scripts/smoke-image.mjs --build-only
 *
 *   With --image: pulls it first, for this machine's linux arch, when the
 *   local image store does not hold it, because the label check reads that
 *   store and a release runner has only just pushed the tag from another
 *   job (`docker image inspect` never pulls; the shared smoke's `docker run`
 *   does). An image already there, such as the `ee` lane's second pass over
 *   the local build, is used as it is.
 *   Without --image: stages dist-slim/ (bundled for THIS machine's linux
 *   arch, `make bundle-ee-slim`) into dist-slim-<arch>/ and builds
 *   stigmer-server-ee:smoke-local with the Enterprise labels first.
 *   --database-url is handed to the no-key smoke (the shared smoke's flag)
 *   and the licensed boot; the bad-key boots run on SQLite, because the
 *   refusal comes before the server reads its database.
 *   --require-license fails the run when STIGMER_EE_SMOKE_LICENSE_KEY is
 *   unset, so a release can never drop step 4 in silence.
 *   --build-only builds that local image, labels checked, prints its tag and
 *   stops: the Helm chart's kind smoke (test/install/smoke-helm.mjs,
 *   --profiles=enterprise) installs the image this smoke proves.
 *
 * Plain node + docker CLI, no dependencies, like the shared smoke.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { connectJson } from "../../../test/install/lib/stigmer-smoke.mjs";

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
/** The variable a run hands its license in; the server's own is STIGMER_LICENSE_KEY. */
const SMOKE_LICENSE_VARIABLE = "STIGMER_EE_SMOKE_LICENSE_KEY";
/** enterprise.ts's line after a verified license, with the kid in `keyId`. */
const VERIFIED_LINE = "Stigmer Enterprise license verified";
/** growth.ts's LICENSE_RENEWAL_MESSAGE opens with this. */
const RENEWAL_PREFIX = "This server's Stigmer Enterprise license has ended";

function parseArgs() {
  let image = "";
  let databaseUrl = "";
  let buildOnly = false;
  let requireLicense = false;
  for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = arg.match(/^--image=(.+)$/)) !== null) image = m[1];
    else if ((m = arg.match(/^--database-url=(.+)$/)) !== null) databaseUrl = m[1];
    else if (arg === "--build-only") buildOnly = true;
    else if (arg === "--require-license") requireLicense = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (buildOnly && image !== "") fail("--build-only builds the local image; it takes no --image");
  return { image, databaseUrl, buildOnly, requireLicense };
}

function fail(message) {
  console.error(`smoke-image: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-image: ${step}`);
}

function docker(args, env = process.env) {
  return execFileSync("docker", args, { encoding: "utf8", env }).trim();
}

/** docker's environment with the server's license variable set, so `-e STIGMER_LICENSE_KEY` passes it by name. */
function withLicense(key) {
  return { ...process.env, STIGMER_LICENSE_KEY: key };
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

/** A pushed tag lives in the registry, not in this runner's image store; a local build lives only in the store. */
function pullImage(image) {
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0) {
    log(`${image} is in the local image store; not pulled`);
    return;
  }
  const platform = `linux/${dockerArch()}`;
  log(`docker pull --platform ${platform} ${image}`);
  execFileSync("docker", ["pull", "--platform", platform, image], { stdio: "inherit" });
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
    docker(["run", "--detach", "--name", container, "-e", "STIGMER_LICENSE_KEY", image], withLicense(key));
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

/** A license's three segments, its header's kid, and its claims as JSON. */
function parseLicense(key) {
  const segments = key.split(".");
  if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error(`${SMOKE_LICENSE_VARIABLE} is not three base64url segments; paste the whole license`);
  }
  const decode = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  const header = decode(segments[0]);
  if (typeof header?.kid !== "string" || header.kid === "") {
    throw new Error(`${SMOKE_LICENSE_VARIABLE}'s header names no kid`);
  }
  return { segments, kid: header.kid, claims: decode(segments[1]) };
}

/** The same license with the customer's name changed and the signature kept. */
function tamperedLicense(license) {
  const claims = structuredClone(license.claims);
  const customer = claims?.customer;
  const field = ["displayName", "display_name"].find((name) => typeof customer?.[name] === "string");
  if (field === undefined) {
    throw new Error("the license's claims carry no customer display name to change; the claims' shape moved");
  }
  customer[field] = `${customer[field]} (altered)`;
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${license.segments[0]}.${payload}.${license.segments[2]}`;
}

/**
 * The server's log entries, as { message, ...fields }. The logger
 * (backend/services/stigmer-server/src/boot/logger.ts) writes either shape:
 * one JSON object per line, or with ENV=local, as the image sets, a
 * readable line `<instant> <LEVEL> <message> <fields as JSON>`. A line in
 * neither shape (node's own warnings) is skipped.
 */
const READABLE_ENTRY = /^\d{4}-\d{2}-\d{2}T\S+Z (DEBUG|INFO|WARN|ERROR)\s+(.*?)(?: (\{.*\}))?$/;

function logEntries(container) {
  const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
  const entries = [];
  for (const line of `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`.split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (entry !== null && typeof entry === "object" && typeof entry.message === "string") entries.push(entry);
      continue;
    } catch {
      // not the JSON shape
    }
    const readable = READABLE_ENTRY.exec(line);
    if (readable === null) continue;
    let fields = {};
    try {
      fields = readable[3] === undefined ? {} : JSON.parse(readable[3]);
    } catch {
      // the message itself ended in braces; keep it whole
      entries.push({ message: `${readable[2]} ${readable[3]}` });
      continue;
    }
    entries.push({ ...fields, message: readable[2] });
  }
  return entries;
}

function tailLogs(container) {
  const logs = spawnSync("docker", ["logs", "--tail", "40", container], { encoding: "utf8" });
  return `${logs.stdout ?? ""}${logs.stderr ?? ""}`;
}

/** A Postgres of the step's own on a private network, for a runner that has none. */
async function startPostgres(suffix) {
  const network = `stigmer-ee-smoke-net-${suffix}`;
  const name = `stigmer-ee-smoke-pg-${suffix}`;
  docker(["network", "create", network]);
  docker([
    "run", "--detach", "--name", name, "--network", network,
    "-e", "POSTGRES_PASSWORD=smoke", "-e", "POSTGRES_DB=stigmer", "postgres:16",
  ]);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    const ready = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "stigmer"], { encoding: "utf8" });
    if (ready.status === 0) break;
    if (Date.now() > deadline) throw new Error(`postgres:16 not ready after ${BOOT_TIMEOUT_MS}ms`);
    await sleep(500);
  }
  return {
    runArgs: ["--network", network],
    databaseUrl: `postgres://postgres:smoke@${name}:5432/stigmer`,
    cleanup: () => {
      spawnSync("docker", ["rm", "--force", "--volumes", name]);
      spawnSync("docker", ["network", "rm", network]);
    },
  };
}

async function assertBootsLicensed(image, databaseUrl, key) {
  const license = parseLicense(key);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const container = `stigmer-server-ee-smoke-licensed-${suffix}`;
  const database =
    databaseUrl !== ""
      ? {
          // host-gateway reaches a host-published Postgres, as the shared smoke does.
          runArgs: ["--add-host=host.docker.internal:host-gateway"],
          databaseUrl,
          cleanup: () => {},
        }
      : await startPostgres(suffix);
  try {
    log(`a license from Stigmer's issuer (kid ${license.kid}): docker run on postgres, issuer https://issuer.invalid`);
    docker(
      [
        "run", "--detach", "--name", container, ...database.runArgs,
        "-p", "127.0.0.1::7234",
        "-e", "STIGMER_LICENSE_KEY",
        "-e", `DATABASE_URL=${database.databaseUrl}`,
        "-e", "STIGMER_OIDC_ISSUER=https://issuer.invalid",
        "-e", "STIGMER_OIDC_AUDIENCE=stigmer-image-smoke",
        // A licensed server may hold many organizations, and it refuses to boot
        // with no sandbox driver unless their shared runner is accepted. The
        // step runs no agent, so it accepts it.
        "-e", "STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS=accepted",
        image,
      ],
      withLicense(key),
    );
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    for (;;) {
      const state = docker([
        "inspect", "--format",
        "{{.State.Status}} {{.State.ExitCode}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
        container,
      ]);
      if (state.endsWith(" healthy")) break;
      if (state.startsWith("exited ")) {
        throw new Error(`the licensed boot exited (${state}); the logs:\n${tailLogs(container)}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`the licensed boot is still ${state} after ${BOOT_TIMEOUT_MS}ms; the logs:\n${tailLogs(container)}`);
      }
      await sleep(1000);
    }
    log("licensed: the container reports healthy");

    const entries = logEntries(container);
    const verified = entries.find((entry) => entry.message === VERIFIED_LINE);
    if (verified === undefined) {
      throw new Error(`healthy without a "${VERIFIED_LINE}" log entry; the logs:\n${tailLogs(container)}`);
    }
    if (verified.keyId !== license.kid) {
      throw new Error(`the boot verified kid ${JSON.stringify(verified.keyId)}; the license names ${JSON.stringify(license.kid)}`);
    }
    log(`licensed: "${VERIFIED_LINE}", keyId ${verified.keyId}, organizations ${verified.organizations}`);
    const lapsed = entries.some((entry) => typeof entry.message === "string" && entry.message.startsWith(RENEWAL_PREFIX));
    log(`licensed: the license is ${lapsed ? "lapsed (the boot logged the renewal warning; the edition stays)" : "current"}`);

    const hostPort = docker(["port", container, "7234/tcp"]).split("\n")[0].split(":").pop();
    const info = await connectJson(
      `http://127.0.0.1:${hostPort}`,
      "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo",
      {},
    );
    if (info.edition !== "enterprise") {
      throw new Error(`getServerInfo answered edition ${JSON.stringify(info.edition)}; want "enterprise"`);
    }
    log("licensed: getServerInfo edition enterprise");

    docker(["stop", "--time", "30", container]);
    const exit = docker(["inspect", "--format", "{{.State.ExitCode}}", container]);
    if (exit !== "0") {
      throw new Error(`the licensed server stopped with exit ${exit}; want 0; the logs:\n${tailLogs(container)}`);
    }
    log("licensed: stopped cleanly, exit 0");
  } finally {
    spawnSync("docker", ["rm", "--force", "--volumes", container]);
    database.cleanup();
  }
  await assertRefuses(image, "the same license with one claim changed", tamperedLicense(license));
}

async function main() {
  const { image: imageArg, databaseUrl, buildOnly, requireLicense } = parseArgs();
  const license = process.env[SMOKE_LICENSE_VARIABLE] ?? "";
  if (requireLicense && license === "" && !buildOnly) {
    fail(`--require-license: ${SMOKE_LICENSE_VARIABLE} is not set, so the licensed boot cannot run`);
  }
  const image = imageArg !== "" ? imageArg : buildLocalImage();
  try {
    if (imageArg !== "") pullImage(image);
    assertLabels(image);
    if (buildOnly) {
      log(`built ${image}`);
      return;
    }
    assertBootsAsOpenSource(image, databaseUrl);
    await assertRefuses(image, "a malformed key", "not-a-license-key");
    await assertRefuses(image, "a key signed by an untrusted key pair", foreignKey());
    if (license !== "") {
      await assertBootsLicensed(image, databaseUrl, license);
    } else {
      log(`a license from Stigmer's issuer: skipped: no license (${SMOKE_LICENSE_VARIABLE} is unset)`);
    }
  } catch (error) {
    console.error(`smoke-image: FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  log("PASS");
}

await main();
