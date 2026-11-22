/**
 * Whether an agent's conversations have a computer (`AgentSpec.computer`),
 * as the console reads it, and the words every surface says about it.
 *
 * The reading rule is the proto's (`session/v1/enum.proto`, `Computer`):
 * only `COMPUTER_NONE` means none, so an agent saved before the setting, or
 * no agent at all (the built-in assistant), has one. This is that single
 * comparison, kept here so the agent's page, the composer and the routine
 * form read it alike. What a computer-less agent may not have is the
 * server's to judge: the console shows the server's refusal and keeps no
 * copy of the rules. It only stops offering choices the server would
 * refuse (a repository, an Environment, the Claude harness).
 *
 * Pinned by `__tests__/computer.test.ts`.
 */

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { HarnessOption } from "@stigmer/react-core";

/** Whether conversations on `spec` have a computer; no agent (the built-in assistant) has one. */
export function agentHasComputer(spec: AgentSpec | undefined): boolean {
  return spec?.computer !== Computer.NONE;
}

/** Whether the agent's computer is fixed on: the Claude harness always runs with one. */
export function computerLocked(spec: AgentSpec | undefined): boolean {
  return spec?.harness === Harness.CLAUDE;
}

/** The harnesses a conversation on `spec` may run on: Stigmer alone without a computer. */
export function harnessesFor(spec: AgentSpec | undefined): readonly HarnessOption[] | undefined {
  return agentHasComputer(spec) ? undefined : NO_COMPUTER_HARNESSES;
}

const NO_COMPUTER_HARNESSES: readonly HarnessOption[] = ["stigmer"];

/** The words every surface uses for an agent's computer. */
export const COMPUTER_COPY = {
  label: "Give this agent a computer",
  on: "It can run commands, read and write files, and work in the repositories and folders a conversation brings.",
  off: "It only talks and calls online tools. It can't run commands, and repositories, folders and environments don't apply.",
  lockedBadge: "Always on",
  locked: "The Claude Agent harness always works on a computer. Pick the Stigmer harness in Run defaults to turn it off.",
  saving: "Saving",
  environmentNotApplying: "Environments don't apply here: this agent has no computer",
  warningsLabel: "Skills with scripts",
} as const;

/** Why the Claude harness isn't offered for an agent without a computer; `agentName` names it, else "this agent". */
export function claudeNotOfferedCopy(agentName?: string): string {
  return `Claude Agent isn't offered: ${agentName && agentName !== "" ? agentName : "this agent"} has no computer`;
}

/** Why a routine's workspace and Environment are left out for an agent without a computer. */
export function routineNotApplyingCopy(agentName?: string): string {
  return `Workspace and Environment don't apply: ${agentName && agentName !== "" ? agentName : "this agent"} has no computer`;
}
