/**
 * The attach push: what a sandbox driver sends a waiting sandbox to make it
 * serve one task queue, and the checks a push passes before the waiter starts
 * a runner for it.
 *
 * A push carries the per-sandbox half of what a sandbox pod receives at
 * start: the queue it serves (`STIGMER_TASK_QUEUE`) and the runner's secret
 * values (`RUNNER_SECRET_ENV_KEYS`). Everything per-target and non-secret
 * belongs in the sandbox's own environment instead, including the Temporal
 * connection settings a pod's Secret also carries but that are not secrets
 * (the server's CA, a client certificate, the server name); and nothing
 * secret may be there: a snapshot of a waiting sandbox is cloned into every
 * sandbox started from it, so it must hold no credential (the waiter's
 * module header, `waiter.ts`).
 *
 * The checks, in order:
 *
 *   1. Shape. A JSON object with a string `taskQueue` and a `secrets` object
 *      of strings whose names are all in `RUNNER_SECRET_ENV_KEYS`: the push
 *      cannot set any other environment variable of the runner.
 *   2. Binding. The queue names one scope and one id (`session:`, `wfexec:`,
 *      `mcpconnect:`), and the sandbox serving it must be the one the server
 *      names for that scope and id: `sbx-<code>-<first 12 hex of sha256(id)>`,
 *      byte-identical to the server's `sandboxBaseName`
 *      (`stigmer-server/src/sandbox/naming.ts`, the one home of the
 *      derivation; this package's test loads that module and compares the two,
 *      since the runner imports nothing from the server). A queue pushed to another sandbox is refused,
 *      so one session's work never runs on another session's workspace. The
 *      binding reads no token, so it holds on every edition, including one
 *      whose tokens name an execution rather than a session, or that runs
 *      tokenless.
 *   3. Token. A non-empty `STIGMER_TOKEN` must be JWT-shaped and, when it
 *      carries `exp`, unexpired. The runner never verifies signatures (the
 *      server does, `client/token-claims.ts`); whoever can reach the waiter
 *      is the sandbox's driver, which is the deployment's to keep true.
 *
 * Status codes: 400 for a malformed push (a NUL byte in any value included:
 * no process can receive it), 403 for one that fails the binding
 * or carries an unusable token.
 */

import { createHash } from "node:crypto";
import { RUNNER_SECRET_ENV_KEYS } from "../shared/runner-credential-keys.js";
import { expiryClaimOf, isJwtShaped } from "../client/token-claims.js";

/** The queue kinds a sandbox serves, with the server's scope codes for each. */
const QUEUE_KINDS = [
  { prefix: "session:", code: "ses" },
  { prefix: "wfexec:", code: "wfx" },
  { prefix: "mcpconnect:", code: "mcp" },
] as const;

const SECRET_NAMES: ReadonlySet<string> = new Set(RUNNER_SECRET_ENV_KEYS);

/** A push that passed every check. */
export interface AttachPush {
  readonly taskQueue: string;
  readonly secrets: Readonly<Record<string, string>>;
}

export type PushVerdict =
  | { readonly ok: true; readonly push: AttachPush }
  | { readonly ok: false; readonly status: 400 | 403; readonly reason: string };

/**
 * The name of the only sandbox allowed to serve a queue, or undefined when the
 * queue is not one a sandbox serves.
 */
export function sandboxNameForQueue(taskQueue: string): string | undefined {
  for (const kind of QUEUE_KINDS) {
    if (taskQueue.startsWith(kind.prefix)) {
      const id = taskQueue.slice(kind.prefix.length);
      if (id === "") return undefined;
      const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
      return `sbx-${kind.code}-${digest}`;
    }
  }
  return undefined;
}

function refuse(status: 400 | 403, reason: string): PushVerdict {
  return { ok: false, status, reason };
}

/**
 * Check a parsed push body against this sandbox's own name and the current
 * time (seconds since the epoch).
 */
export function verifyAttachPush(
  body: unknown,
  sandboxName: string,
  nowSeconds: number,
): PushVerdict {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse(400, "the push must be a JSON object");
  }
  const { taskQueue, secrets } = body as Record<string, unknown>;
  if (typeof taskQueue !== "string" || taskQueue === "") {
    return refuse(400, "taskQueue must be a non-empty string");
  }
  // An environment value holding a NUL byte cannot reach a process (Node
  // refuses it at spawn), so it is refused here rather than at the start.
  if (taskQueue.includes("\u0000")) {
    return refuse(400, "taskQueue holds a NUL byte");
  }
  if (typeof secrets !== "object" || secrets === null || Array.isArray(secrets)) {
    return refuse(400, "secrets must be an object of strings");
  }
  const accepted: Record<string, string> = {};
  for (const [name, value] of Object.entries(secrets as Record<string, unknown>)) {
    if (!SECRET_NAMES.has(name)) {
      return refuse(400, `secrets may only name the runner's secret variables; got ${name}`);
    }
    if (typeof value !== "string") {
      return refuse(400, `secret ${name} must be a string`);
    }
    if (value.includes("\u0000")) {
      return refuse(400, `secret ${name} holds a NUL byte`);
    }
    accepted[name] = value;
  }

  const expected = sandboxNameForQueue(taskQueue);
  if (expected === undefined) {
    return refuse(403, `${taskQueue} is not a queue a sandbox serves`);
  }
  if (expected !== sandboxName) {
    return refuse(403, `this sandbox does not serve ${taskQueue}`);
  }

  const token = accepted.STIGMER_TOKEN ?? "";
  if (token !== "") {
    if (!isJwtShaped(token)) {
      return refuse(403, "STIGMER_TOKEN is not a JWT");
    }
    const expiry = expiryClaimOf(token);
    if (expiry !== undefined && expiry <= nowSeconds) {
      return refuse(403, "STIGMER_TOKEN has expired");
    }
  }

  return { ok: true, push: { taskQueue, secrets: accepted } };
}
