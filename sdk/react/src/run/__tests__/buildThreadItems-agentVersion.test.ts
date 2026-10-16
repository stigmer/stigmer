/**
 * buildThreadItems: the agent version each turn ran
 * (`RunStatus.agent_version_hash`, a stamp on the turn's run). With a label
 * function the thread marks the version where it starts and wherever it
 * changes, so every turn reads under the version it ran; a turn that
 * recorded none (the built-in assistant) adds no marker; without the label
 * function the thread is unchanged.
 */
import { describe, it, expect } from "vitest";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { runOf, said, status, turnsOf, user } from "./__fixtures__/thread-events";

const label = (hash: string) => (hash === "h2" ? "v2" : hash.slice(0, 12));

function build(versions: Record<string, string>, withLabel: boolean): ThreadItem[] {
  const ids = Object.keys(versions);
  const turns = turnsOf(ids.flatMap((id) => [user(id, `message ${id}`), said(id, 0, "ok"), status(id, "completed")]));
  const runs: Run[] = ids.map((id) => runOf(id, { status: { agentVersionHash: versions[id] } }));
  return buildThreadItems(turns, runs, withLabel ? { agentVersionLabel: label } : {});
}

function markers(items: readonly ThreadItem[]) {
  return items.flatMap((item) =>
    item.kind === "agent-version" ? [{ key: item.key, label: item.label }] : [],
  );
}

describe("buildThreadItems — agent version markers", () => {
  it("marks the first turn's version and each change, labelled by the given function", () => {
    const items = build({ a: "h1", b: "h1", c: "h2", d: "h2" }, true);

    expect(markers(items)).toEqual([
      { key: "a-agent-version", label: "h1" },
      { key: "c-agent-version", label: "v2" },
    ]);
    // The marker opens the turn it belongs to, before its prompt.
    const prompt = items.findIndex((item) => item.key === "c-spec");
    expect(items[prompt - 1]?.kind).toBe("agent-version");
  });

  it("adds no marker for a turn that recorded no version", () => {
    expect(markers(build({ a: "", b: "" }, true))).toEqual([]);
  });

  it("is unchanged without a label function", () => {
    expect(markers(build({ a: "h1", b: "h2" }, false))).toEqual([]);
  });
});
