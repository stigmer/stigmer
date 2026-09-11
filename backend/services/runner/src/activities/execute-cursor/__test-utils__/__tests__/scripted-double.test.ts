/**
 * The scripted `@cursor/sdk` double's own arms — the surface the harness
 * contract kit's Cursor subject drives, added at S2 M4 beside the golden
 * scenarios' declared-up-front surface (which the seventeen goldens prove).
 *
 *  - `arrangeNextTurn` writes the slot the NEXT `send()` consumes, replaces a
 *    slot already arranged, and never touches a slot already consumed or one
 *    declared for a later send.
 *  - `nextRunId` names the run the next send will be given, so a script can be
 *    built with matching event ids before the send happens.
 *  - `agentForWorkspaceRef` hands `Agent.create` the agent declared for the
 *    session the create names (via `platform.workspaceRef`), consulted before
 *    the ordered list and registered for `Agent.resume` by id; a create with no
 *    session, or a session the resolver does not know, falls through to the
 *    list as before.
 */

import { describe, it, expect } from "vitest";
import type { AgentOptions, SDKMessage } from "@cursor/sdk";

import { ScriptedCursorAgent, defaultRunId, sdkEvents, step } from "../scripted-agent.js";
import { ScriptedCursorSdk } from "../scripted-sdk.js";

/** An agent whose declared turns each play the given events and finish. */
function agent(id: string, turns: SDKMessage[][] = []): ScriptedCursorAgent {
  return new ScriptedCursorAgent({ agentId: id, turns: turns.map((events) => [...events.map((e) => step.event(e)), step.finished()]) });
}

async function drain(a: ScriptedCursorAgent): Promise<string[]> {
  const run = await a.send("go");
  const texts: string[] = [];
  for await (const event of run.stream()) {
    if (event.type === "assistant") texts.push(event.message.content.map((c) => (c.type === "text" ? c.text : "")).join(""));
  }
  await run.wait();
  return texts;
}

describe("ScriptedCursorAgent.arrangeNextTurn", () => {
  it("writes the slot the next send consumes and replaces an arrangement not yet played", async () => {
    const a = agent("a1");
    const ev = sdkEvents("a1", a.nextRunId);
    a.arrangeNextTurn([step.event(ev.assistant("first arrangement")), step.finished()]);
    a.arrangeNextTurn([step.event(ev.assistant("replaced")), step.finished()]);

    expect(await drain(a)).toEqual(["replaced"]);
  });

  it("leaves a consumed slot and a later declared slot where they are", async () => {
    const ev1 = sdkEvents("a2", defaultRunId("a2", 0));
    const ev3 = sdkEvents("a2", defaultRunId("a2", 2));
    const a = agent("a2", [[ev1.assistant("declared one")], [ev1.assistant("declared two")], [ev3.assistant("declared three")]]);

    expect(await drain(a)).toEqual(["declared one"]);
    a.arrangeNextTurn([step.event(sdkEvents("a2", a.nextRunId).assistant("arranged two")), step.finished()]);
    expect(await drain(a)).toEqual(["arranged two"]);
    expect(await drain(a), "the third slot was declared up front and stands").toEqual(["declared three"]);
  });

  it("a send with no slot is a test bug and throws", async () => {
    const a = agent("a3");
    await expect(a.send("go")).rejects.toThrow(/send\(\) #1 has no script/);
  });
});

describe("ScriptedCursorAgent.nextRunId", () => {
  it("is the id the next send is given — the declared one, else the default", async () => {
    const declared = new ScriptedCursorAgent({ agentId: "a4", runIds: ["run-x"], turns: [[step.finished()], [step.finished()]] });
    expect(declared.nextRunId).toBe("run-x");
    const run1 = await declared.send("go");
    expect(run1.id).toBe("run-x");
    expect(declared.nextRunId, "no second id declared: the default, counting sends from 1").toBe(defaultRunId("a4", 1));
    const run2 = await declared.send("go");
    expect(run2.id).toBe("run-a4-2");
  });
});

describe("ScriptedCursorSdk.agentForWorkspaceRef", () => {
  const createFor = (workspaceRef: string | undefined): AgentOptions =>
    ({ apiKey: "k", ...(workspaceRef !== undefined ? { platform: { workspaceRef, stateRoot: "/tmp/x" } } : {}) }) as unknown as AgentOptions;

  it("hands out the session's agent before the ordered list and registers it for resume", () => {
    const forSession = agent("session-agent");
    const listed = agent("listed-agent");
    const sdk = new ScriptedCursorSdk({
      agents: [listed],
      catalog: [],
      agentForWorkspaceRef: (ref) => (ref === "stigmer-session:ses-1" ? forSession : undefined),
    });

    expect(sdk.create(createFor("stigmer-session:ses-1"))).toBe(forSession);
    expect(sdk.resume("session-agent", undefined)).toBe(forSession);
    expect(sdk.create(createFor("stigmer-session:unknown")), "an unknown session falls through to the list").toBe(listed);
    expect(sdk.resolutions.map((r) => `${r.kind}:${r.agentId}`)).toEqual(["create:session-agent", "resume:session-agent", "create:listed-agent"]);
  });

  it("a create without a platform ref falls through to the ordered list", () => {
    const listed = agent("listed-only");
    const sdk = new ScriptedCursorSdk({ agents: [listed], catalog: [], agentForWorkspaceRef: () => agent("never") });
    expect(sdk.create(createFor(undefined))).toBe(listed);
  });
});
