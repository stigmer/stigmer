// Lifecycle control for runs (cancel / terminate / pause / resume).
//
// Each verb returns the resulting phase as a human label, read back from the
// server so the success line reports the authoritative post-mutation state.
// terminate, pause and resume issue the run controller RPC. cancel
// interrupts the run's session (runs.ts `cancelAgentRun`): every unfinished
// turn of the conversation stops, and the turns it stopped are reported. A
// run that had already ended is left as it is and says so.
//
// These return a plain `{ phase }` rather than a CommandResult so the command
// layer owns presentation (single source of the success wording).

import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  PauseRunInputSchema,
  ResumeRunInputSchema,
  TerminateRunInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { cancelAgentRun, formatAgentPhase } from "./runs.js";

/** Outcome of a control verb: the post-mutation phase. */
export interface ControlResult {
  readonly phase: string;
}

/** Outcome of a cancel: the phase, whether it had already ended, and the turns stopped. */
export interface CancelResult extends ControlResult {
  readonly wasAlreadyTerminal: boolean;
  readonly stoppedRunIds: readonly string[];
}

/** Cancel a run: interrupt its session, stopping every unfinished turn of it. */
export async function cancelRun(client: Stigmer, id: string): Promise<CancelResult> {
  const { run, wasAlreadyTerminal, stoppedRunIds } = await cancelAgentRun(client, id);
  return { ...toResult(run), wasAlreadyTerminal, stoppedRunIds };
}

/** Force-stop a run immediately. */
export async function terminateRun(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  return toResult(await client.run.terminate(create(TerminateRunInputSchema, { id, reason })));
}

/** Pause a run in progress. */
export async function pauseRun(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  return toResult(await client.run.pause(create(PauseRunInputSchema, { id, reason })));
}

/** Resume a paused run (no reason). */
export async function resumeRun(client: Stigmer, id: string): Promise<ControlResult> {
  return toResult(await client.run.resume(create(ResumeRunInputSchema, { id })));
}

function toResult(run: Run): ControlResult {
  return { phase: formatAgentPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
}
