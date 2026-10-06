/**
 * The TS-server half of the cross-edition HITL scenario corpus
 * (apis/testdata/hitl/scenarios) — ports fixtures_test.go: every scenario
 * is projected BOTH ways (message scan and shadow event stream) and both
 * must equal the expected pending_approvals. The Go and Java editions
 * load the same files, so a behavioral drift in any edition fails one of
 * the suites.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computePendingApprovals } from "../compute.js";
import { computePendingApprovalsFromEvents } from "../compute-from-events.js";
import { emitApprovalEvents } from "../emit.js";
import {
  corpusFiles,
  decodeMessages,
  decodePendingApprovals,
  decodeSubAgents,
  diffPendingApprovals,
  readCorpusJson,
} from "./corpus-support.js";

interface ScenarioFixture {
  name: string;
  input: {
    messages?: unknown[];
    sub_agent_executions?: unknown[];
  };
  expected: {
    pending_approvals?: unknown[];
  };
}

describe("shared HITL scenario corpus", () => {
  const files = corpusFiles("scenarios");

  // Guard the guard: a silently empty corpus would pass for the wrong
  // reason. The plan mandates >= 10 scenarios (Go asserts the same).
  it("discovers the corpus", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    it(path.basename(file), () => {
      const fx = readCorpusJson(file) as unknown as ScenarioFixture;

      const messages = decodeMessages(fx.input.messages as never);
      const subAgents = decodeSubAgents(fx.input.sub_agent_executions as never);
      const want = decodePendingApprovals(
        fx.expected.pending_approvals as never,
      );

      // Path 1: the message scan.
      const fromScan = computePendingApprovals(messages, subAgents);
      expect(
        diffPendingApprovals(want, fromScan),
        "message-scan projection != expected",
      ).toBe("");

      // Path 2: the event-stream projection over the shadow seed must
      // agree with the same expectation — the parity the corpus enforces.
      const fromEvents = computePendingApprovalsFromEvents(
        emitApprovalEvents(messages, subAgents),
      );
      expect(
        diffPendingApprovals(want, fromEvents),
        "event-stream projection != expected",
      ).toBe("");
    });
  }
});
