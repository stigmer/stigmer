// Tests for the NDJSON renderer: each stored event is one line on the data
// sink, its Managed Agents JSON and nothing else, Stigmer's own events under
// their stigmer.* type; the fold writes nothing; an ask answered with no
// --approve-default is noted on the status sink, one answered by the flag is
// not.

import { foldSession, toManagedAgentsJson, type ToolUse } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { asked, phase, said, use, user } from "../../__test-utils__/session-events.js";
import type { HeadlessRenderer } from "../headless.js";
import { NdjsonRenderer } from "../render-ndjson.js";

function renderer() {
  let data = "";
  let status = "";
  const r = new NdjsonRenderer({ data: { write: (s) => void (data += s) }, status: { write: (s) => void (status += s) } });
  return { r, data: () => data, status: () => status };
}

describe("NdjsonRenderer", () => {
  it("writes one Managed Agents JSON line per stored event", () => {
    const events = [user("run_a", "hi"), said("run_a", 0, "Hello."), phase("run_a", "completed")];
    const ctx = renderer();
    for (const event of events) ctx.r.event(event);
    (ctx.r as HeadlessRenderer).fold(foldSession(events));

    const lines = ctx.data().trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual(events.map((event) => JSON.parse(JSON.stringify(toManagedAgentsJson(event)))));
    expect(lines.map((line) => line.type)).toEqual(["user.message", "agent.message", "stigmer.run.status"]);
    expect(lines[1].content).toEqual([{ type: "text", text: "Hello." }]);
    expect(lines[2].phase).toBe("completed");
    expect(ctx.status()).toBe("");
  });

  it("notes a deny on stderr only when --approve-default is unset", () => {
    const events = [user("run_a", "go"), use("run_a", "c1", "shell", { permission: "ask" }), asked("run_a", "c1")];
    const ask = foldSession(events).turns[0]?.asks[0] as ToolUse;

    const unset = renderer();
    unset.r.answering(ask, "");
    expect(unset.status()).toBe("⚠ No --approve-default set; denying shell\n");
    expect(unset.data()).toBe("");

    const set = renderer();
    set.r.answering(ask, "allow");
    expect(set.status()).toBe("");
  });
});
