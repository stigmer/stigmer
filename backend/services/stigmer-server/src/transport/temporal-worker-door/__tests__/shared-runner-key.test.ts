/**
 * The shared-runner key at the Temporal worker lane
 * (shared-runner-key.ts): the key, and only the exact key, is admitted to
 * the runner queue, with no per-queue poll limit (every shared runner polls
 * that one queue); any other bearer (a near miss, a prefix, the empty
 * string) goes on to the provider's own answer; with no key configured,
 * the provider's answer alone, so a bearer equal to "" is never admitted.
 * The lane's own refusal of every method it does not serve, and of every
 * queue but the admitted one, is lane.test.ts's.
 */
import { describe, expect, it } from "vitest";

import { sharedRunnerKeyQueueOf } from "../shared-runner-key.js";

const KEY = "k".repeat(40);

describe("sharedRunnerKeyQueueOf", () => {
  it("admits the key to the runner queue with no per-queue limit, and hands every other bearer to the provider", async () => {
    const asked: string[] = [];
    const queueOf = sharedRunnerKeyQueueOf(KEY, "stigmer_runner", async (raw) => {
      asked.push(raw);
      return raw === "sandbox-token" ? { queue: "session:ses_1", pollLimit: "per-sandbox" } : undefined;
    });
    expect(await queueOf(KEY)).toEqual({ queue: "stigmer_runner", pollLimit: "in-all-only" });
    expect(await queueOf("sandbox-token")).toEqual({ queue: "session:ses_1", pollLimit: "per-sandbox" });
    expect(await queueOf(KEY.slice(0, -1))).toBeUndefined();
    expect(await queueOf(`${KEY}x`)).toBeUndefined();
    expect(await queueOf("")).toBeUndefined();
    expect(asked).toEqual(["sandbox-token", KEY.slice(0, -1), `${KEY}x`, ""]);
  });

  it("with no key configured, is the provider's answer alone", async () => {
    const otherwise = async () => undefined;
    expect(sharedRunnerKeyQueueOf("", "stigmer_runner", otherwise)).toBe(otherwise);
  });
});
