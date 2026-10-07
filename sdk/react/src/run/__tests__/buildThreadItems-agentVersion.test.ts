import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";

// ---------------------------------------------------------------------------
// buildThreadItems: the agent version each turn ran
// (`AgentRunStatus.agent_version_hash`).
//
// With a label function the thread marks the version where it starts and
// wherever it changes, so every turn reads under the version it ran; a turn
// that recorded none (the built-in assistant) adds no marker; without the
// label function the thread is unchanged.
// ---------------------------------------------------------------------------

function turn(id: string, versionHash: string): Run {
  return create(RunSchema, {
    metadata: { id },
    spec: { target: { case: "sessionId", value: "ses_1" }, message: `message ${id}` },
    status: { phase: RunPhase.RUN_COMPLETED, agentVersionHash: versionHash },
  });
}

const label = (hash: string) => (hash === "h2" ? "v2" : hash.slice(0, 12));

function markers(items: readonly ThreadItem[]) {
  return items.flatMap((item) =>
    item.kind === "agent-version" ? [{ key: item.key, label: item.label }] : [],
  );
}

function build(executions: Run[], withLabel: boolean) {
  return buildThreadItems(
    executions, null, null, false, undefined, undefined,
    false, false, false, false, undefined,
    withLabel ? label : undefined,
  );
}

describe("buildThreadItems — agent version markers", () => {
  it("marks the first turn's version and each change, labelled by the given function", () => {
    const items = build([turn("a", "h1"), turn("b", "h1"), turn("c", "h2"), turn("d", "h2")], true);

    expect(markers(items)).toEqual([
      { key: "a-agent-version", label: "h1" },
      { key: "c-agent-version", label: "v2" },
    ]);
    // The marker opens the turn it belongs to, before its prompt.
    const firstPrompt = items.findIndex((item) => item.key === "c-spec");
    expect(items[firstPrompt - 1]?.kind).toBe("agent-version");
  });

  it("adds no marker for a turn that recorded no version", () => {
    expect(markers(build([turn("a", ""), turn("b", "")], true))).toEqual([]);
  });

  it("is unchanged without a label function", () => {
    expect(markers(build([turn("a", "h1"), turn("b", "h2")], false))).toEqual([]);
  });
});
