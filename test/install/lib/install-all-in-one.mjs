/**
 * The all-in-one evaluation image (deploy/all-in-one) as an install a script
 * can bring up, move to another release, and take down: the one place that
 * knows how the image is run, shared by its smoke
 * (scripts/smoke-all-in-one.mjs) and the upgrade rehearsal
 * (scripts/rehearse-upgrade.mjs).
 *
 * A container runs the way all-in-one.mdx tells a user to: one named volume
 * at /data, the model's ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL as -e flags,
 * and host.docker.internal mapped so the model can live on this host. Its
 * ports are published on random loopback ports, so it never contends for
 * 7234 with another stack on the machine; every URL is read from Docker
 * after each (re)start, because a restart can move them.
 *
 * An upgrade is the guide's: stop and remove the container, then run the new
 * tag against the same volume.
 *
 * Plain node and the docker CLI, no dependencies, like its neighbours.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pollUntil } from "./stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const imageRoot = join(repoRoot, "deploy", "all-in-one");

/** The published image's repository: `ghcr.io/stigmer/stigmer:v<version>`. */
export const ALL_IN_ONE_REPOSITORY = "ghcr.io/stigmer/stigmer";
/** The tag a source build of the image is given. */
export const LOCAL_IMAGE = "stigmer-all-in-one:smoke-local";

// Temporal boots, the server gates, the runner polls; generous for shared CI hosts.
const HEALTHY_TIMEOUT_MS = 180_000;
// The daemon's graceful teardown budget (runner, server, then Temporal).
export const STOP_GRACE_SECONDS = 30;

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options }).trim();
}

/**
 * The image a release runs as: the published tag, or a local build from
 * deploy/all-in-one/stage (stage-all-in-one.mjs must have run; its VERSION
 * is the version the build is stamped with).
 */
export function allInOneImage(release, log) {
  if (release.kind === "published") return `${ALL_IN_ONE_REPOSITORY}:v${release.version}`;
  const versionFile = join(imageRoot, "stage", "VERSION");
  if (!existsSync(versionFile)) {
    throw new Error("deploy/all-in-one/stage is not staged — run `node scripts/stage-all-in-one.mjs` first");
  }
  const version = readFileSync(versionFile, "utf8").trim();
  log(`docker build ${LOCAL_IMAGE} (STIGMER_VERSION=${version})`);
  execFileSync("docker", ["build", "--build-arg", `STIGMER_VERSION=${version}`, "--tag", LOCAL_IMAGE, imageRoot], {
    stdio: "inherit",
  });
  return LOCAL_IMAGE;
}

/** Host port docker published for a container port, bound to loopback. */
function publishedPort(container, containerPort) {
  const out = docker(["port", container, String(containerPort)]);
  const m = out.match(/:(\d+)\s*$/m);
  if (m === null) throw new Error(`docker port ${container} ${containerPort} -> ${JSON.stringify(out)}`);
  return Number(m[1]);
}

/**
 * An all-in-one install configured with `model`, on a volume of its own.
 * Nothing runs until `start`, so a caller holds the container name, the
 * volume and the diagnostics however far a start got.
 */
export function createAllInOne({ model, log, suffix = `${Date.now()}` }) {
  const container = `stigmer-aio-smoke-${suffix}`;
  const volume = `${container}-data`;
  let image = "";

  const run = (target) => {
    image = target;
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--publish",
      "127.0.0.1::7234",
      "--publish",
      "127.0.0.1::7235",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--env",
      `ANTHROPIC_API_KEY=${model.ANTHROPIC_API_KEY}`,
      "--env",
      `ANTHROPIC_BASE_URL=${model.ANTHROPIC_BASE_URL}`,
      "--volume",
      `${volume}:/data`,
      target,
    ]);
  };

  return {
    container,
    volume,
    /** The image the container was last run from. */
    get image() {
      return image;
    },
    baseUrl: () => `http://127.0.0.1:${publishedPort(container, 7234)}`,
    artifactUrl: () => `http://127.0.0.1:${publishedPort(container, 7235)}`,
    async start(target) {
      run(target);
    },
    /** The guide's upgrade: stop and remove the container, then the new tag on the same volume. */
    async upgrade(target) {
      log(`docker stop --time ${STOP_GRACE_SECONDS}, docker rm, then docker run ${target} on ${volume}`);
      docker(["stop", "--time", String(STOP_GRACE_SECONDS), container]);
      docker(["rm", container]);
      run(target);
    },
    /** Docker `healthy`: the image's own HEALTHCHECK line. */
    async waitHealthy() {
      await pollUntil(`${container} healthy`, HEALTHY_TIMEOUT_MS, () => {
        const status = docker(["inspect", "--format", "{{.State.Health.Status}}", container]);
        if (status === "unhealthy") throw new Error("container reported unhealthy");
        if (docker(["inspect", "--format", "{{.State.Running}}", container]) !== "true") {
          throw new Error("container is not running");
        }
        return status === "healthy";
      });
    },
    /** The image reference the running container was created from. */
    async images() {
      return { "all-in-one": docker(["inspect", "--format", "{{.Config.Image}}", container]) };
    },
    diagnostics() {
      const logs = spawnSync("docker", ["logs", "--tail", "150", container], { encoding: "utf8" });
      const tails =
        image === ""
          ? { stdout: "" }
          : spawnSync(
              "docker",
              [
                "run",
                "--rm",
                "--volume",
                `${volume}:/data`,
                "--entrypoint",
                "sh",
                image,
                "-c",
                "tail -n 40 /data/.stigmer/data/logs/*.log /data/.stigmer/data/logs/temporal.log 2>/dev/null",
              ],
              { encoding: "utf8" },
            );
      return [
        "--- docker logs (last 150 lines) ---",
        logs.stdout ?? "",
        logs.stderr ?? "",
        "--- component logs on the volume ---",
        tails.stdout ?? "",
      ].join("\n");
    },
    async stop() {
      spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
      spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
    },
  };
}
