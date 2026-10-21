/**
 * The scripted `@cursor/sdk` double's own arms — the surface the harness
 * contract kit's Cursor subject drives, added in #1070 beside the golden
 * scenarios' declared-up-front surface (which the seventeen goldens prove).
 *
 *  - `arrangeNextTurn` writes the slot the NEXT `send()` consumes, replaces a
 *    slot already arranged, and never touches a slot already consumed or one
 *    declared for a later send.
 *  - `nextRunId` names the run the next send will be given, so a script can be
 *    built with matching event ids before the send happens.
 *  - `agentForWorkspaceRef` hands `Agent.create` the agent declared for the
 *    session the create names (via the `workspaceRef` of the scripted store it
 *    passes as `local.store`), consulted before the ordered list and
 *    registered for `Agent.resume` by id; a create with no store, or a session
 *    the resolver does not know, falls through to the list as before.
 *  - `ScriptedLocalAgentStore.open` (the `@cursor/sdk/sqlite` double) records
 *    every open and dispose on the bound SDK, so a scenario can assert the
 *    adapter's session-store lifetime.
 *  - The held run (stigmer#2487): a send while the agent's newest run is
 *    still active is refused as the SDK refuses it, unless it passes
 *    `local.force`, which expires that run; a run whose process was killed
 *    (`strand`) stays active in the store though the harness cancelled it;
 *    and the store double's `agents.get` / `runs.get` read what is held.
 */

import { describe, it, expect } from "vitest";
import type { AgentOptions, Run, SDKMessage } from "@cursor/sdk";

import { ScriptedCursorAgent, defaultRunId, sdkEvents, step } from "../scripted-agent.js";
import { ScriptedCursorSdk, ScriptedLocalAgentStore, bindScriptedSdk } from "../scripted-sdk.js";

/** Play a run to its end, as the harness consumes one. */
async function finish(run: Run): Promise<void> {
  for await (const event of run.stream()) void event;
  await run.wait();
}

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
    await finish(run1);
    expect(declared.nextRunId, "no second id declared: the default, counting sends from 1").toBe(defaultRunId("a4", 1));
    const run2 = await declared.send("go");
    expect(run2.id).toBe("run-a4-2");
  });
});

describe("ScriptedCursorSdk.agentForWorkspaceRef", () => {
  // The scripted store carries only the members the runner touches, not the
  // SDK's whole `LocalAgentStore`, hence the cast — the same one the mocked
  // module makes when it stands in for `@cursor/sdk/sqlite`.
  const createFor = (workspaceRef: string | undefined): AgentOptions =>
    ({
      apiKey: "k",
      local: workspaceRef !== undefined ? { store: new ScriptedLocalAgentStore(workspaceRef, "/tmp/x") } : undefined,
    }) as unknown as AgentOptions;

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

  it("a create without a store falls through to the ordered list", () => {
    const listed = agent("listed-only");
    const sdk = new ScriptedCursorSdk({ agents: [listed], catalog: [], agentForWorkspaceRef: () => agent("never") });
    expect(sdk.create(createFor(undefined))).toBe(listed);
  });
});

describe("ScriptedLocalAgentStore (the @cursor/sdk/sqlite double)", () => {
  it("open hands out a store carrying the ref and root asked for, and records opens and disposes on the bound SDK", async () => {
    const sdk = new ScriptedCursorSdk({ agents: [], catalog: [] });
    bindScriptedSdk(sdk);

    const store = await ScriptedLocalAgentStore.open({ workspaceRef: "stigmer-session:ses-9", stateRoot: "/tmp/ses-9" });
    expect(store.workspaceRef).toBe("stigmer-session:ses-9");
    expect(store.stateRoot).toBe("/tmp/ses-9");
    expect(sdk.stores).toEqual([store]);

    await store.dispose();
    expect(store.disposeCalls).toBe(1);
  });
});

describe("the held run", () => {
  const twoTurns = (id: string): ScriptedCursorAgent => new ScriptedCursorAgent({ agentId: id, turns: [[step.finished()], [step.finished()]] });

  it("refuses a send while the newest run is active, as the SDK does, and a forced send expires it", async () => {
    const a = twoTurns("a-held-1");
    const first = await a.send("go");
    await expect(a.send("again")).rejects.toThrow("Agent a-held-1 already has active run");
    await a.send("again", { local: { force: true } });
    expect(a.runs.map((r) => r.storeStatus)).toEqual(["expired", "running"]);
    expect(first.status, "the expired run's own view is untouched").toBe("running");
  });

  it("takes the next send once the run ended, unforced", async () => {
    const a = twoTurns("a-held-2");
    await finish(await a.send("go"));
    await finish(await a.send("again"));
    expect(a.sends.map((s) => s.force)).toEqual([false, false]);
  });

  it("keeps a stranded run active in the store though the harness cancelled it, and the store reads what is held", async () => {
    const a = twoTurns("a-held-3");
    const sdk = new ScriptedCursorSdk({ agents: [a], catalog: [] });
    bindScriptedSdk(sdk);
    const store = new ScriptedLocalAgentStore("stigmer-session:held", "/tmp/held");
    const run = await a.send("go");
    a.strand();
    await run.cancel();
    expect(run.status, "the killed process's own view ends").toBe("cancelled");
    expect(await store.agents.get({ agentId: "a-held-3" })).toMatchObject({ activeRunId: run.id, status: "running" });
    expect(await store.runs.get({ agentId: "a-held-3", runId: run.id })).toMatchObject({ status: "running" });
    await expect(a.send("again")).rejects.toThrow(/already has active run/);
    expect(await store.agents.get({ agentId: "nobody" })).toBeNull();
  });
});
