/**
 * Which conversations a runner serves, and the memory each turn without a
 * computer may use: the runner's two settings for serving many
 * organizations from one process, read and checked once at boot.
 *
 * `STIGMER_RUNNER_SERVES`:
 *
 *  - `all` (the default): every conversation, as a runner always has. Its
 *    turns without a computer run in the locked hosts, each started at its
 *    slot's first such turn (`agent-host/hosting.ts`).
 *  - `computerless`: only conversations without a computer. Such a runner is
 *    meant to be shared by many organizations (the server sends it
 *    computer-less turns from every organization when its operator says so),
 *    so it is built to trust no turn with another's anything:
 *     - its locked hosts start at boot, one per turn slot, and no open host
 *       runs a turn (one starts only to store relayed saved state, on a runner
 *       whose checkpointer keeps it in a local file);
 *     - a turn whose conversation has a computer is refused with a sentence
 *       naming this setting ({@link refusalForServes}), even when routing is
 *       wrong;
 *     - in the cloud a turn must carry its own credential, sealed or clear
 *       ({@link credentialRequiredActivities}); its own key opens only its
 *       Temporal door, so a turn run without one could reach nothing;
 *     - it holds a payload key, the one that opens a sealed credential
 *       ({@link assertServesCanBoot});
 *     - its `STIGMER_TOKEN` is a static key, never a token: it is not
 *       renewed or exchanged, no bootstrap is discovered with it, and its one
 *       use is the Temporal API key behind the server (`runner.ts`).
 *
 * `STIGMER_TURN_MEMORY_MB` (default 512): the V8 heap a locked host may grow
 * to (`--max-old-space-size`), one host per turn slot and one turn per host
 * (`agent-host/host-pool.ts`), so a turn that grows past it ends only
 * itself, with {@link outOfMemorySentence}.
 *
 * An unknown value of either stops the boot with a sentence: a typo must
 * never quietly serve every conversation, or no memory bound.
 */

import { EXECUTE_CLAUDE_ACTIVITY_NAME, EXECUTE_DEEP_AGENT_ACTIVITY_NAME, GENERATE_SESSION_SUBJECT_ACTIVITY_NAME } from "@stigmer/temporal-codecs/activity-names";

/** Which conversations a runner serves (the module header). */
export type RunnerServes = "all" | "computerless";

const SERVES: readonly RunnerServes[] = ["all", "computerless"];

/** `STIGMER_RUNNER_SERVES`, or `all` when unset; throws a sentence on any other value. */
export function parseRunnerServes(raw: string | undefined): RunnerServes {
  if (raw === undefined || raw === "") return "all";
  const found = SERVES.find((value) => value === raw);
  if (found === undefined) {
    throw new Error(
      `STIGMER_RUNNER_SERVES=${JSON.stringify(raw)} is not a setting this runner knows: set "all" to serve every conversation, ` +
        `or "computerless" to serve only conversations without a computer.`,
    );
  }
  return found;
}

/** The heap each turn's locked host may grow to, in megabytes, when `STIGMER_TURN_MEMORY_MB` is unset. */
export const DEFAULT_TURN_MEMORY_MB = 512;

/** The least `STIGMER_TURN_MEMORY_MB` a locked host can boot its engine in. */
export const MIN_TURN_MEMORY_MB = 128;

/** `STIGMER_TURN_MEMORY_MB`, or {@link DEFAULT_TURN_MEMORY_MB} when unset; throws a sentence on anything but a whole number of at least {@link MIN_TURN_MEMORY_MB}. */
export function parseTurnMemoryMb(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TURN_MEMORY_MB;
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < MIN_TURN_MEMORY_MB) {
    throw new Error(
      `STIGMER_TURN_MEMORY_MB=${JSON.stringify(raw)} is not a whole number of megabytes of at least ${MIN_TURN_MEMORY_MB}; ` +
        `it bounds the memory of each turn without a computer (default ${DEFAULT_TURN_MEMORY_MB}).`,
    );
  }
  return parsed;
}

/**
 * Whether a runner that serves `serves` may boot: `null` when it may, else
 * the sentence it stops with. A runner that serves only conversations
 * without a computer must hold a payload key, which opens the sealed
 * credential each of its turns carries.
 */
export function servesBootRefusal(serves: RunnerServes, payloadKey: string | undefined): string | null {
  if (serves !== "computerless" || (payloadKey !== undefined && payloadKey !== "")) return null;
  return (
    "STIGMER_RUNNER_SERVES=computerless needs STIGMER_PAYLOAD_ENCRYPTION_KEY (and its _KEY_ID), the server's payload key: " +
    "each turn's credential arrives sealed with it, and a runner that can't open one can't run the turn."
  );
}

/** {@link servesBootRefusal}, thrown. */
export function assertServesCanBoot(serves: RunnerServes, payloadKey: string | undefined): void {
  const refusal = servesBootRefusal(serves, payloadKey);
  if (refusal !== null) throw new Error(refusal);
}

/**
 * The activities a runner refuses when their dispatch carries no
 * credential: a cloud runner that serves only conversations without a
 * computer requires one on every activity that acts for a turn; every other
 * runner requires none.
 */
export function credentialRequiredActivities(serves: RunnerServes, mode: "local" | "cloud"): ReadonlySet<string> {
  if (serves !== "computerless" || mode !== "cloud") return new Set();
  return new Set([EXECUTE_DEEP_AGENT_ACTIVITY_NAME, EXECUTE_CLAUDE_ACTIVITY_NAME, GENERATE_SESSION_SUBJECT_ACTIVITY_NAME]);
}

/**
 * Why this runner refuses a turn of a conversation with (`computer`) or
 * without a computer, or `undefined` when it serves it: a runner that
 * serves only conversations without one refuses every conversation that has
 * one, whatever sent it here.
 */
export function refusalForServes(serves: RunnerServes, computer: boolean): string | undefined {
  if (serves === "computerless" && computer) {
    return (
      "This conversation has a computer, and this runner serves only conversations without one (STIGMER_RUNNER_SERVES=computerless), " +
      "so it did not run the turn. Run it on a runner that serves conversations with a computer."
    );
  }
  return undefined;
}

/** The sentence a turn that ran out of its memory ends with: the person's to read, naming the bound. */
export function outOfMemorySentence(memoryMb: number): string {
  return `This turn ran out of memory (${memoryMb} MB) and was stopped. Start a new turn or simplify the request.`;
}
