/**
 * How a sandbox image's runner is started: the one home of the launch
 * command every driver gives the runner container, of the paths an image
 * must hold for it, and of the user and home the drivers run it as.
 *
 * A sandbox image is a base image (the agent's OS and tools) with the runner
 * layer added on top, everything of the runner under `/runner`
 * (backend/services/runner/Dockerfile.sandbox):
 *
 *   - `/runner/bin/start`: the launch command. A `sh` script
 *     (backend/services/runner/layer/start.sh) that refuses a base image the
 *     runner cannot run on, naming what is missing, clears the base's
 *     `NODE_OPTIONS` and `NODE_PATH`, and execs the Node beside it with its
 *     arguments unchanged. It is the only thing that can speak on a base
 *     without glibc, where the Node itself cannot start.
 *   - `/runner/bin/node`: the runner's own Node, at the repository's
 *     `.nvmrc` version, never on the agent's `PATH`, so the agent's `node`
 *     stays the base image's own and a runner Node upgrade is never a change
 *     an agent's commands can see. The waiter and the Cursor approval hook
 *     reach it as `process.execPath`.
 *   - `/runner/dist/main.js`: the runner (the slim runner artifact, its
 *     `node_modules` beside it in `/runner/dist`).
 *   - `/runner/dist/attach/main.js`: the attach waiter, the entry of a
 *     sandbox that is snapshotted before it is attached (the Substrate
 *     driver's template); it starts `../main.js` with the same Node.
 *
 * The base image contract has two halves: what the start script checks,
 * and what the drivers set. A driver runs the runner as root (uid 0, which
 * the runner needs to install packages at runtime) with `HOME` at root's
 * home, whatever the base image's own `USER` and `ENV` say; a driver whose
 * platform cannot set the user (Substrate) leaves it to the start script's
 * refusal.
 *
 * The image's CMD is `/bin/bash` by design, so a driver always sets the
 * command, from here. The compose runner image bakes the same runner
 * command as its CMD (scripts/runner-launch-contract.test.mjs at the
 * repository root pins the two together). A composition imports these from
 * the barrel rather than writing its own copy, so its launch command moves
 * with the server release that names its image.
 *
 * Each function returns a fresh array: a driver may hand it to a manifest
 * builder that keeps the reference.
 */

/** The runner layer's start script, which execs {@link RUNNER_NODE}. */
export const RUNNER_START = "/runner/bin/start";

/** The runner's own Node binary in the image. */
export const RUNNER_NODE = "/runner/bin/node";

/** The runner's entry in the image. */
export const RUNNER_ENTRY = "/runner/dist/main.js";

/** The attach waiter's entry in the image. */
export const WAITER_ENTRY = "/runner/dist/attach/main.js";

/** The uid (and gid) a driver runs the runner as: root. */
export const RUNNER_UID = 0;

/** The `HOME` a driver gives the runner: root's home in every glibc base. */
export const RUNNER_HOME = "/root";

/** The command that starts the runner in a sandbox container. */
export function runnerCommand(): string[] {
  return [RUNNER_START, RUNNER_ENTRY];
}

/** The command that starts the attach waiter in a sandbox container. */
export function waiterCommand(): string[] {
  return [RUNNER_START, WAITER_ENTRY];
}
