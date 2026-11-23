/**
 * The one placement rule (placement.ts), as a table: every routing mode,
 * target, computer stamp, driver and switch, and the answer each must
 * give. The rows that pin safety: with shared runners off, no turn is ever
 * `shared` under per-session routing (an edition takes this code before
 * any runner polls the shared queue); a conversation with a computer, or
 * an unset stamp, is never `shared`; and the Environment policy's
 * question agrees with the rule for a conversation with a computer.
 */
import { ExecutionTarget, Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";

import { placeTurn, sandboxServesTarget, type TurnPlacement } from "../placement.js";
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

type Row = [string, AgentExecutionTemporalConfig, ExecutionTarget, Computer | undefined, boolean, string, TurnPlacement];

const ROWS: Row[] = [
  ["global routing, as always", GLOBAL_OFF, ExecutionTarget.UNSPECIFIED, Computer.REQUIRED, false, "ses_1", "shared"],
  ["global routing with shared runners on", GLOBAL_ON, ExecutionTarget.CLOUD, Computer.NONE, false, "ses_1", "shared"],
  ["session routing with no session id", SESSION_CLOUD_ON, ExecutionTarget.CLOUD, Computer.NONE, true, "", "shared"],
  ["a sandboxed conversation", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.REQUIRED, true, "ses_1", "sandbox"],
  ["an unset stamp has a computer", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.UNSPECIFIED, true, "ses_1", "sandbox"],
  ["no stamp read has a computer", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, undefined, true, "ses_1", "sandbox"],
  ["no computer, shared runners on", SESSION_CLOUD_ON, ExecutionTarget.UNSPECIFIED, Computer.NONE, true, "ses_1", "shared"],
  ["no computer, shared runners on, no driver", SESSION_CLOUD_ON, ExecutionTarget.CLOUD, Computer.NONE, false, "ses_1", "shared"],
  ["no computer, shared runners OFF: as before", SESSION_CLOUD_OFF, ExecutionTarget.UNSPECIFIED, Computer.NONE, true, "ses_1", "sandbox"],
  ["no computer, shared runners OFF, no driver: as before", SESSION_CLOUD_OFF, ExecutionTarget.CLOUD, Computer.NONE, false, "ses_1", "own"],
  ["a CLOUD target with no driver", SESSION_CLOUD_ON, ExecutionTarget.CLOUD, Computer.REQUIRED, false, "ses_1", "own"],
  ["a LOCAL target (the desktop) never moves", SESSION_CLOUD_ON, ExecutionTarget.LOCAL, Computer.NONE, true, "ses_1", "own"],
  ["UNSPECIFIED resolving LOCAL never moves", SESSION_LOCAL_ON, ExecutionTarget.UNSPECIFIED, Computer.NONE, true, "ses_1", "own"],
];

describe("placeTurn", () => {
  it.each(ROWS)("%s", (_label, cfg, target, computer, sandboxLane, sessionId, expected) => {
    expect(placeTurn({ config: cfg, target, computer, sandboxLane, sessionId })).toBe(expected);
  });

  it("with shared runners off, never answers shared under per-session routing", () => {
    for (const target of [ExecutionTarget.UNSPECIFIED, ExecutionTarget.LOCAL, ExecutionTarget.CLOUD]) {
      for (const computer of [undefined, Computer.UNSPECIFIED, Computer.REQUIRED, Computer.NONE]) {
        for (const sandboxLane of [true, false]) {
          expect(placeTurn({ config: SESSION_CLOUD_OFF, target, computer, sandboxLane, sessionId: "ses_1" })).not.toBe("shared");
        }
      }
    }
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
