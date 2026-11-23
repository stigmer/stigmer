/**
 * The shared-runner key at the Temporal worker lane: a runner that serves
 * turns of conversations without a computer for many people
 * (domain/run/placement.ts `shared`) presents the server's
 * STIGMER_SHARED_RUNNER_KEY as its token, and the lane admits it to the
 * runner queue (`stigmer_runner`) alone, exactly as it admits a sandbox to
 * its own queue. Every shared runner polls that one queue, so its admission
 * carries no per-queue poll limit, only the lane's limit in all
 * (capacity.ts).
 *
 * The key is read HERE and nowhere else. It is not a caller identity: no
 * verifier knows it, so on every other server call it is an unknown bearer
 * and is refused wherever the server signs its callers in. A shared runner
 * therefore holds no Temporal address and nothing else of the server's,
 * and every call a turn makes must carry that turn's own credential; a
 * call site that forgets fails loudly instead of acting as the runner.
 *
 * The comparison is constant-time over SHA-256 digests, so neither the
 * key's length nor a prefix leaks through timing, and the key is never
 * stored or logged. Any other bearer goes on to the credential provider's
 * own answer (lane.ts `credentialQueueOf`).
 *
 * Tests: __tests__/shared-runner-key.test.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import type { LaneAdmission } from "./lane.js";

/**
 * The lane's `queueOf` with the shared-runner key in front: the runner queue
 * for the key, the credential provider's answer for any other bearer. With
 * no key configured, the provider's answer alone.
 */
export function sharedRunnerKeyQueueOf(
  key: string,
  runnerQueue: string,
  otherwise: (rawToken: string) => Promise<LaneAdmission | undefined>,
): (rawToken: string) => Promise<LaneAdmission | undefined> {
  if (key === "") {
    return otherwise;
  }
  const expected = digest(key);
  const admission: LaneAdmission = { queue: runnerQueue, pollLimit: "in-all-only" };
  return async (rawToken) => (timingSafeEqual(digest(rawToken), expected) ? admission : otherwise(rawToken));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
