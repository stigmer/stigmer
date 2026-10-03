/**
 * How a sandbox image's runner is started: the one home of the launch
 * command every driver gives the runner container, and of the paths an
 * image must hold for it.
 *
 * A sandbox image is a base image (the agent's OS and tools) with the runner
 * layer added on top, everything of the runner under `/runner`
 * (backend/services/runner/Dockerfile.sandbox):
 *
 *   - `/runner/bin/node`: the runner's own Node, at the repository's
 *     `.nvmrc` version. The drivers start it by absolute path, so the
 *     agent's `node` stays the base image's own and a runner Node upgrade is
 *     never a change an agent's commands can see.
 *   - `/runner/dist/main.js`: the runner (the slim runner artifact, its
 *     `node_modules` beside it in `/runner/dist`).
 *   - `/runner/dist/attach/main.js`: the attach waiter, the entry of a
 *     sandbox that is snapshotted before it is attached (the Substrate
 *     driver's template); it starts `../main.js` with the same Node.
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

/** The runner's own Node binary in the image. */
export const RUNNER_NODE = "/runner/bin/node";

/** The runner's entry in the image. */
export const RUNNER_ENTRY = "/runner/dist/main.js";

/** The attach waiter's entry in the image. */
export const WAITER_ENTRY = "/runner/dist/attach/main.js";

/** The command that starts the runner in a sandbox container. */
export function runnerCommand(): string[] {
  return [RUNNER_NODE, RUNNER_ENTRY];
}

/** The command that starts the attach waiter in a sandbox container. */
export function waiterCommand(): string[] {
  return [RUNNER_NODE, WAITER_ENTRY];
}
