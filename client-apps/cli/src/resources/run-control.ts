// Lifecycle control for runs (cancel / terminate / pause / resume).
//
// Mirrors Go's execution.Cancel/Terminate/Pause/Resume (cancel.go + pause.go):
// each verb issues the agent-run controller RPC and returns the resulting
// phase as a human label. The phase is read back from the RPC response so the
// success line reports the authoritative post-mutation state, exactly as the
// Go CLI does.
//
// These return a plain `{ phase }` rather than a CommandResult so the command
// layer owns presentation (single source of the success wording).

import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CancelRunInputSchema,
  PauseRunInputSchema,
  ResumeRunInputSchema,
  TerminateRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { formatAgentPhase } from "./runs.js";

/** Outcome of a control verb: the post-mutation phase. */
export interface ControlResult {
  readonly phase: string;
}

/** Gracefully cancel a run. Mirrors Go execution.Cancel. */
export async function cancelRun(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  return toResult(await client.run.cancel(create(CancelRunInputSchema, { id, reason })));
}

/** Force-stop a run immediately. Mirrors Go execution.Terminate. */
export async function terminateRun(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  return toResult(await client.run.terminate(create(TerminateRunInputSchema, { id, reason })));
}

/** Pause a run in progress. Mirrors Go execution.Pause. */
export async function pauseRun(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  return toResult(await client.run.pause(create(PauseRunInputSchema, { id, reason })));
}

/** Resume a paused run. Mirrors Go execution.Resume (no reason). */
export async function resumeRun(client: Stigmer, id: string): Promise<ControlResult> {
  return toResult(await client.run.resume(create(ResumeRunInputSchema, { id })));
}

function toResult(run: Run): ControlResult {
  return { phase: formatAgentPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
}
