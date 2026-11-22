/**
 * Whether a conversation has a computer: the one reading of
 * `SessionStatus.computer` the runner makes. Only `COMPUTER_NONE` means
 * none, so a conversation from before the setting keeps its computer.
 *
 * Read by the Stigmer engine's shell binding (no shell for the parent or any
 * subagent without one, `execute-deep-agent/turn-setup.ts`) and by the
 * phases that put a turn's skills and plugins on disk
 * (`harness/turn-context.ts`): a conversation without a computer mounts no
 * skill and no plugin tree, since nothing in it can run them, and its file
 * tools read them from the store (`archive-reader.ts`), and by the turn's
 * refusal of what a conversation without one cannot have
 * (`harness/turn-context.ts` `refuseUnservableTurn`), which reads a saved
 * subagent's own setting and hooks the same way.
 */

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

export function hasComputer(session: Session | undefined): boolean {
  return session?.status?.computer !== Computer.NONE;
}

/** Whether a saved agent's conversations have a computer (`AgentSpec.computer`), by the same rule. */
export function agentHasComputer(spec: AgentSpec): boolean {
  return spec.computer !== Computer.NONE;
}

/** Whether an agent's own hooks block holds any hook: the server's reading (stigmer-server `domain/run/computer.ts`). */
export function hasOwnHooks(spec: AgentSpec): boolean {
  return spec.hooks.some((source) => source.source.case === "inline" && source.source.value.groups.length > 0);
}
