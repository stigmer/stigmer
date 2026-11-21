/**
 * The console's reading of an agent's computer (../computer.ts): only
 * COMPUTER_NONE means none, so an agent saved before the setting and no
 * agent at all have one; the Claude harness locks it on; an agent without
 * one is offered the Stigmer harness alone; the copy names the agent, or
 * says "this agent".
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { agentHasComputer, claudeNotOfferedCopy, computerLocked, harnessesFor, routineNotApplyingCopy } from "../computer";

describe("agentHasComputer", () => {
  it("reads only COMPUTER_NONE as none", () => {
    expect(agentHasComputer(create(AgentSpecSchema, { computer: Computer.NONE }))).toBe(false);
    expect(agentHasComputer(create(AgentSpecSchema, { computer: Computer.REQUIRED }))).toBe(true);
    expect(agentHasComputer(create(AgentSpecSchema))).toBe(true);
    expect(agentHasComputer(undefined)).toBe(true);
  });
});

describe("computerLocked and harnessesFor", () => {
  it("locks the Claude harness on, and offers Stigmer alone without a computer", () => {
    expect(computerLocked(create(AgentSpecSchema, { harness: Harness.CLAUDE }))).toBe(true);
    expect(computerLocked(create(AgentSpecSchema, { harness: Harness.STIGMER }))).toBe(false);
    expect(harnessesFor(create(AgentSpecSchema, { computer: Computer.NONE }))).toEqual(["stigmer"]);
    expect(harnessesFor(create(AgentSpecSchema))).toBeUndefined();
  });
});

describe("the copy", () => {
  it("names the agent, or says this agent", () => {
    expect(claudeNotOfferedCopy("Support desk")).toBe("Claude Agent isn't offered: Support desk has no computer");
    expect(claudeNotOfferedCopy()).toBe("Claude Agent isn't offered: this agent has no computer");
    expect(routineNotApplyingCopy("")).toBe("Workspace and Environment don't apply: this agent has no computer");
  });
});
