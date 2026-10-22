/**
 * The Cursor engine's delivery of the messages a person sends while its
 * turn works (`harness/turn-input.ts`): steered into the running run where
 * Cursor takes one, otherwise sent as one more round of the same turn.
 *
 *   - While a run streams, each time the runtime's hint says messages wait
 *     (`TurnSink.input.onPending`), the turn takes them and steers each
 *     text into the run (`Run.steer`, @cursor/sdk 1.0.31). Cursor answers
 *     `complete_delivered` once the run has it, read at its own next step,
 *     or `revert_to_followup` when it cannot take it now (a run of a cloud
 *     agent, a stored handle, a run about to end). A message that carries
 *     files is never steered: a steer takes text alone.
 *   - When the turn's round ends completed, it asks once more, whatever the
 *     hint says, and every message the run took that Cursor does not have
 *     (reverted, carrying files, taken as the run ended, or taken by an
 *     earlier invocation that never delivered it) goes as one follow-up
 *     send, its files listed and its images inline as a turn's own are.
 *     `turn.ts` runs that round, and asks again after it.
 *
 * Which messages Cursor has is the runner's own record, beside the SDK's
 * store as `held-run.ts` keeps the run each send started: written by rename
 * after every steer Cursor accepted and every follow-up send that returned,
 * so an approval pause or a continuation on this machine never sends one
 * twice. A continued turn's prompt carries the run's record of the turn,
 * the messages it took among it (`harness/continuation-digest.ts`), so a
 * continuation counts every message the run took before it as delivered.
 *
 * Upstream limit, named once in the turn's conversation as a system note
 * when a follow-up round goes ({@link FOLLOW_UP_NOTE}, `turn.ts`): a message
 * Cursor reverts is read when the run's round ends, not at its next step.
 *
 * Proven by __tests__/turn-input.test.ts and the harness contract kit's
 * message arms.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "@cursor/sdk";

import type { TurnSink } from "../../harness/types.js";
import type { TurnMessage } from "../../harness/turn-input.js";
import { hasInputFiles, visionPromptInfoOf } from "../../shared/prompt-sections.js";
import { formatInputFiles } from "./prompt-builder.js";

/** What the conversation says, once, when a message goes as a follow-up: Cursor's upstream limit, named (the module header). */
export const FOLLOW_UP_NOTE =
  "A message sent while the agent worked could not be handed to the Cursor run in progress; it was sent as soon as the run's round ended, in the same turn.";

/** The record's file, in the session's SDK state root, beside the sent-run record. */
export const DELIVERED_INPUTS_FILE = "stigmer-delivered-inputs.json";

/** The record: the messages of one run Cursor has. */
interface DeliveredInputs {
  readonly executionId: string;
  readonly ids: readonly string[];
}

/** One turn's delivery (module header). */
export interface CursorTurnInput {
  /** Steer what waits into `run` while it streams; returns the unsubscribe. */
  steerInto(run: Run): () => void;
  /** What the round's end owes Cursor: what still waits, and what the run took that Cursor does not have. */
  owed(): Promise<TurnMessage[]>;
  /** Record that Cursor has `messages` (a follow-up send returned). */
  delivered(messages: readonly TurnMessage[]): Promise<void>;
}

/**
 * The delivery for one invocation. `stateRoot` is the session's SDK state
 * root (a local agent's; a cloud agent keeps no record and steers nothing
 * Cursor accepts); `continued` is a continued turn, whose prompt carries
 * what the run took (module header).
 */
export async function newCursorTurnInput(
  sink: TurnSink,
  executionId: string,
  stateRoot: string | undefined,
  continued: boolean,
): Promise<CursorTurnInput> {
  const have = new Set(stateRoot === undefined ? [] : await readDelivered(stateRoot, executionId));
  if (continued) {
    for (const message of await sink.input.claimed(have)) have.add(message.id);
  }
  const record = async (ids: readonly string[]): Promise<void> => {
    for (const id of ids) have.add(id);
    if (stateRoot !== undefined && ids.length > 0) await writeDelivered(stateRoot, { executionId, ids: [...have] });
  };
  let steering: Promise<void> = Promise.resolve();
  return {
    steerInto(run) {
      let streaming = true;
      const steer = async (): Promise<void> => {
        if (!streaming || run.steer === undefined) return;
        for (const message of await sink.input.claim()) {
          if (message.message.length > 0) continue;
          try {
            if ((await run.steer(message.text)) === "complete_delivered") await record([message.id]);
          } catch (err) {
            console.warn(`[cursor-input] steer failed; the message goes as a follow-up: execution=${executionId}, ${String(err)}`);
          }
        }
      };
      const onPending = (): void => {
        steering = steering.then(steer);
      };
      if (sink.input.pending()) onPending();
      const leave = sink.input.onPending(onPending);
      return () => {
        streaming = false;
        leave();
      };
    },
    async owed() {
      await steering;
      await sink.input.claim({ force: true });
      return sink.input.claimed(have);
    },
    delivered: (messages) => record(messages.map((message) => message.id)),
  };
}

/** The follow-up send's text: each message with its files listed, as a turn's own message lists them. */
export function followUpText(messages: readonly TurnMessage[]): string {
  return messages
    .map((message) => {
      const files = { message: message.message, conversation: [], references: [] };
      return hasInputFiles(files) ? `${formatInputFiles(files, visionPromptInfoOf(message))}\n\n${message.text}` : message.text;
    })
    .join("\n\n");
}

async function readDelivered(stateRoot: string, executionId: string): Promise<readonly string[]> {
  let text: string;
  try {
    text = await readFile(join(stateRoot, DELIVERED_INPUTS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as Partial<DeliveredInputs>;
    return parsed.executionId === executionId && Array.isArray(parsed.ids) ? parsed.ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function writeDelivered(stateRoot: string, record: DeliveredInputs): Promise<void> {
  const file = join(stateRoot, DELIVERED_INPUTS_FILE);
  const pending = `${file}.next`;
  await writeFile(pending, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(pending, file);
}
