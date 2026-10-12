/**
 * The HITL scenario corpus (apis/testdata/hitl/scenarios): every scenario's
 * rows, through the message scan (compute.ts), must give the expected
 * pending approvals. The scan describes each waiting call; which calls
 * wait is the session log's (pending.ts), so the corpus pins the
 * description alone.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computePendingApprovals } from "../compute.js";
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
    sub_agent_runs?: unknown[];
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
      const subAgents = decodeSubAgents(fx.input.sub_agent_runs as never);
      const want = decodePendingApprovals(
        fx.expected.pending_approvals as never,
      );

      const fromScan = computePendingApprovals(messages, subAgents);
      expect(
        diffPendingApprovals(want, fromScan),
        "message-scan projection != expected",
      ).toBe("");
    });
  }
});
