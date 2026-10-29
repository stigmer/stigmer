/**
 * What the person sees of the Stigmer harness's agent's background commands: the
 * registry's reports (`shared/shell/background-commands.ts`
 * `BackgroundListeners`) turned into the turn's transcript facts
 * (`harness/transcript/events.ts`), applied through `sink.transcript`, the
 * one way a fact reaches the turn's rows.
 *
 *   - A start is `background_command_started`, at once: the registry starts
 *     the command inside the starting call, and the builder keeps the
 *     command by call id, so no row needs to exist first.
 *   - Output is `background_output_delta`, coalesced per command to the
 *     streaming floor (`shared/streaming-scheduler.ts`): a fragment goes at
 *     once after a quiet spell, and what arrives within the floor waits for
 *     its end, so a chatty dev server sends at most two facts a second, as
 *     a foreground command's streamed output does (`shell-tool.ts`). In a
 *     hosted turn each fact crosses to the runtime as a notice, so the floor
 *     bounds that channel too.
 *   - An end is `background_command_ended`, after the command's waiting
 *     output, with how it ended and who stopped it, and what it printed as a
 *     foreground command's result would carry it (the head and tail of each
 *     stream, `run-command.ts`). It asks for a persist, so the ending reaches
 *     the session's log at once even while the agent runs a long foreground
 *     tool and nothing else would write.
 *
 * No LangChain here: the registry is the source, never the graph's stream,
 * which sees nothing of a command after its starting call returned. Pinned
 * by `__tests__/background-facts.test.ts`, and on a real graph by
 * `__tests__/background-binding.test.ts`.
 */

import type { BackgroundCommandEndedEvent } from "../../harness/transcript/events.js";
import type { TurnSink } from "../../harness/types.js";
import type { BackgroundCommand, BackgroundListeners } from "../../shared/shell/background-commands.js";
import { endingOf, formatCommandOutput } from "../../shared/shell/run-command.js";

/** One command's output waiting for the floor. */
interface Waiting {
  text: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** The registry's listeners over `sink` (the module header); `floorMs` is the streaming floor. */
export function backgroundFacts(sink: Pick<TurnSink, "transcript" | "requestPersist">, floorMs: number): BackgroundListeners {
  const waiting = new Map<string, Waiting>();
  const lastSentAt = new Map<string, number>();

  const send = (id: string): void => {
    const output = waiting.get(id);
    if (output === undefined) return;
    if (output.timer !== undefined) clearTimeout(output.timer);
    waiting.delete(id);
    lastSentAt.set(id, Date.now());
    if (output.text !== "") sink.transcript.apply({ kind: "background_output_delta", callId: id, delta: output.text });
  };

  return {
    onStarted: (command) => {
      sink.transcript.apply({ kind: "background_command_started", callId: command.id, timeoutSeconds: command.timeoutSeconds });
    },

    onOutput: (id, chunk) => {
      const output = waiting.get(id) ?? { text: "", timer: undefined };
      output.text += chunk;
      waiting.set(id, output);
      if (output.timer !== undefined) return;
      const due = (lastSentAt.get(id) ?? Number.NEGATIVE_INFINITY) + floorMs - Date.now();
      if (due <= 0) {
        send(id);
        return;
      }
      output.timer = setTimeout(() => send(id), due);
      output.timer.unref?.();
    },

    onEnded: (command) => {
      send(command.id);
      lastSentAt.delete(command.id);
      sink.transcript.apply(endedFact(command));
      void sink.requestPersist();
    },
  };
}

/** A command's end as its transcript fact; `command.result` is set. */
export function endedFact(command: BackgroundCommand): BackgroundCommandEndedEvent {
  const result = command.result!;
  const ending = endingOf(result, command.timeoutSeconds);
  const base = { kind: "background_command_ended" as const, callId: command.id };
  switch (ending.kind) {
    case "exited":
      return { ...base, ending: "exited", exitCode: ending.exitCode, output: formatCommandOutput(result) };
    case "timed-out":
      return { ...base, ending: "timed_out", output: formatCommandOutput(result) };
    case "stopped": {
      // The registry names who stopped every command it stops; an abort it
      // did not ask for would be the invocation's own end.
      const by = command.stoppedBy ?? { by: "turn" as const };
      return {
        ...base,
        ending: "stopped",
        stoppedBy: by.by,
        ...(by.by === "agent" && by.callId !== "" ? { stoppedByCallId: by.callId } : {}),
        output: formatCommandOutput(result),
      };
    }
    case "spawn-failed":
      return { ...base, ending: "failed_to_start", output: ending.message };
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no ending reaches it */
    default: {
      const exhaustive: never = ending;
      throw new Error(`background facts: unknown command ending ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}
