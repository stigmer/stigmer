/**
 * The one placement rule (placement.ts), as two tables. The stamp's rule:
 * a conversation is stamped shared only under per-session routing, with
 * shared runners on, a CLOUD target and no computer (an unset computer
 * reads as having one). The turn's rule: every turn is placed by the stamp,
 * never by the server's settings at the time, so a conversation made
 * before shared runners keeps its sandbox when they come on, and one
 * stamped shared stays shared when they go off (dispatch refuses its turn,
 * dispatch.test.ts). And the Environment policy's question agrees with the
 * rule for a conversation with a computer.
 */
import { Computer, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";

import { placeTurn, sandboxServesTarget, sharedRunnerFor, type TurnPlacement } from "../placement.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../temporal/config.js";

function config(routing: string, defaultTarget: string, sharedRunners: boolean): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig("agent_execution_stigmer", "stigmer_runner", routing, defaultTarget, sharedRunners);
}

const SESSION_CLOUD_ON = config(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_CLOUD, true);
const SESSION_CLOUD_OFF = config(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_CLOUD, false);
const SESSION_LOCAL_ON = config(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_LOCAL, true);
const GLOBAL_ON = config(ROUTING_GLOBAL, DEFAULT_EXECUTION_TARGET_LOCAL, true);
const GLOBAL_OFF = config(ROUTING_GLOBAL, DEFAULT_EXECUTION_TARGET_LOCAL, false);

describe("sharedRunnerFor (the stamp)", () => {
  const rows: Array<[string, AgentExecutionTemporalConfig, ExecutionTarget, Computer | undefined, boolean]> = [
    ["no computer, shared runners on", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.NONE, true],
    ["a computer", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.REQUIRED, false],
    ["an unset computer has one", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.UNSPECIFIED, false],
    ["no computer read has one", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, undefined, false],
    ["shared runners off", SESSION_CLOUD_OFF, ExecutionTarget.UNSPECIFIED, Computer.NONE, false],
    ["a LOCAL target (the desktop)", SESSION_CLOUD_ON, ExecutionTarget.LOCAL, Computer.NONE, false],
    ["UNSPECIFIED resolving LOCAL", SESSION_LOCAL_ON, ExecutionTarget.UNSPECIFIED, Computer.NONE, false],
    ["global routing", GLOBAL_ON, ExecutionTarget.CLOUD, Computer.NONE, false],
  ];
  it.each(rows)("%s", (_label, cfg, target, computer, expected) => {
    expect(sharedRunnerFor({ config: cfg, target, computer })).toBe(expected);
  });
});

describe("placeTurn (by the stamp)", () => {
  const rows: Array<[string, AgentExecutionTemporalConfig, ExecutionTarget, boolean, boolean, string, TurnPlacement]> = [
    ["global routing, as always", GLOBAL_OFF, ExecutionTarget.UNSPECIFIED, false, false, "ses_1", "shared"],
    ["session routing with no session id", SESSION_CLOUD_ON, ExecutionTarget.CLOUD, false, true, "", "shared"],
    ["a conversation stamped shared", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, true, true, "ses_1", "shared"],
    ["stamped shared, shared runners now off: still shared", SESSION_CLOUD_OFF, ExecutionTarget.UNSPECIFIED, true, true, "ses_1", "shared"],
    ["not stamped, shared runners now on: still its sandbox", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, false, true, "ses_1", "sandbox"],
    ["a CLOUD target with no driver", SESSION_CLOUD_ON, ExecutionTarget.CLOUD, false, false, "ses_1", "own"],
    ["a LOCAL target never moves", SESSION_CLOUD_ON, ExecutionTarget.LOCAL, false, true, "ses_1", "own"],
  ];
  it.each(rows)("%s", (_label, cfg, target, sharedRunner, sandboxLane, sessionId, expected) => {
    expect(placeTurn({ config: cfg, target, sharedRunner, sandboxLane, sessionId })).toBe(expected);
  });
});

describe("sandboxServesTarget", () => {
  it("is the rule's answer for a conversation with a computer", () => {
    expect(sandboxServesTarget(SESSION_CLOUD_ON, true, ExecutionTarget.UNSPECIFIED)).toBe(true);
    expect(sandboxServesTarget(SESSION_CLOUD_ON, false, ExecutionTarget.CLOUD)).toBe(false);
    expect(sandboxServesTarget(SESSION_CLOUD_ON, true, ExecutionTarget.LOCAL)).toBe(false);
    expect(sandboxServesTarget(GLOBAL_ON, true, ExecutionTarget.CLOUD)).toBe(false);
  });
});
