/**
 * Pins how a turn admits a served call (`turn.ts` `admitHeld`): the gate's
 * verdict first, then the session store holding the call before it runs.
 * Without the second, a runner lost after the host's shell started, but
 * before the engine's entry for the call was stored, left a store without
 * the call, and the resumed engine made the call again: it ran twice
 * (stigmer#2669). A refusal is answered at once, and a store that never
 * acknowledges the call lets it run at the bound, with a warning.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServedCall } from "../loopback-mcp.js";
import { MirroredCalls } from "../session-store.js";
import { MIRROR_WAIT_MS, admitHeld } from "../turn.js";

const CALL: ServedCall = { server: "stigmer", tool: "bash", args: { command: "make migrate" }, toolUseId: "toolu_migrate" };
const STORED = { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_migrate", name: "mcp__stigmer__bash", input: {} }] } };
const allow = { admit: () => undefined };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("admitHeld", () => {
  it("answers the gate's refusal at once, never waiting on the store", async () => {
    const refused = await admitHeld({ admit: () => "This call already ran; it was not run again." }, new MirroredCalls(), CALL, "exec-1");
    expect(refused).toBe("This call already ran; it was not run again.");
  });

  it("lets an allowed call run only once the store holds it", async () => {
    const mirrored = new MirroredCalls();
    let settled = false;
    const admitted = admitHeld(allow, mirrored, CALL, "exec-1").then((answer) => {
      settled = true;
      return answer;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled, "the call waits while the store lacks it").toBe(false);
    mirrored.note([STORED]);
    expect(await admitted).toBeUndefined();
  });

  it("runs a call the store never acknowledges at the bound, and says so", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admitted = admitHeld(allow, new MirroredCalls(), CALL, "exec-1");
    await vi.advanceTimersByTimeAsync(MIRROR_WAIT_MS);
    expect(await admitted).toBeUndefined();
    expect(warn.mock.calls.map((args) => String(args[0]))).toEqual([expect.stringContaining("did not hold the call within")]);
  });

  it("admits a call the engine sent without its id as the gate decides, with nothing to wait on", async () => {
    expect(await admitHeld(allow, new MirroredCalls(), { ...CALL, toolUseId: "" }, "exec-1")).toBeUndefined();
  });
});
