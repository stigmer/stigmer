/**
 * Pins the Cursor engine's hook setup (`turn-setup.ts` `prepareHooks`,
 * `installGate`):
 *  - no evaluator for an agent without hooks;
 *  - a cloud agent with hooks is refused (it loads no hook of the runner's);
 *  - a running hook pulses the turn's activity, so the stall watchdog sees a
 *    working hook as alive;
 *  - the tools Cursor shows no hook are hidden when a hook would take them;
 *  - a gate install that fails takes the hook server down with it.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { TurnSink } from "../../../harness/types.js";
import { HookSetupError } from "../../../shared/hooks/setup.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { newTurnStreamState } from "../turn-stream.js";
import { installGate, prepareHooks, type CursorAdapterConfig } from "../turn-setup.js";

const config = { cursorStreamStallTimeoutMs: 30 } as CursorAdapterConfig;

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "prepare-hooks-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function inputWith(groups: HookGroup[], dir = workspace()) {
  return turnInputFixture({ workspaceDir: dir, hooks: { sources: [{ plugin: null, format: "claude-code", groups }], pluginServers: new Map() } });
}

const preToolUse = (matcher: string, command: string) =>
  create(HookGroupSchema, { event: "PreToolUse", matcher, handlers: [create(HookHandlerSchema, { command })] });

describe("prepareHooks", () => {
  const sink = () => ({ stopSignal: new AbortController().signal, recordActivity: vi.fn() });

  it("builds nothing for an agent without hooks", async () => {
    expect(await prepareHooks(turnInputFixture(), sink(), config, { agentMode: "local" })).toBeNull();
  });

  it("refuses a cloud agent with hooks", async () => {
    await expect(prepareHooks(inputWith([preToolUse("Bash", "true")]), sink(), config, { agentMode: "cloud" })).rejects.toThrow(HookSetupError);
  });

  it("pulses the turn's activity while a hook runs, and hides the tools a hook would take", async () => {
    const s = sink();
    const hooks = await prepareHooks(inputWith([preToolUse("", "sleep 0.2")]), s, config, { agentMode: "local" });
    expect(hooks?.hiddenTools).toEqual(["webFetch", "webSearch"]);
    await hooks!.evaluator.preToolUse({ id: "c", name: "Shell", args: { command: "ls" }, serverSlug: "" }, {});
    expect(s.recordActivity).toHaveBeenCalledWith("hook the agent's hooks");
  });
});

describe("installGate", () => {
  it("takes the hook server down when the gate cannot be installed", async () => {
    const dir = workspace();
    const home = mkdtempSync(join(tmpdir(), "prepare-hooks-home-"));
    const realHome = process.env["HOME"];
    process.env["HOME"] = home;
    onTestFinished(() => {
      if (realHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = realHome;
      rmSync(home, { recursive: true, force: true });
    });
    // A file where the gate writes its `.cursor` directory: the install fails.
    writeFileSync(join(dir, ".cursor"), "not a directory", "utf-8");
    const input = inputWith([preToolUse("Bash", "true")], dir);
    const s = { stopSignal: new AbortController().signal, recordActivity: vi.fn() };
    const hooks = await prepareHooks(input, s, config, { agentMode: "local" });
    // A temporary directory of the test's own: other suites' hook servers come and go in the shared one.
    const ownTmp = mkdtempSync(join(tmpdir(), "prepare-hooks-tmp-"));
    const realTmp = process.env["TMPDIR"];
    process.env["TMPDIR"] = ownTmp;
    onTestFinished(() => {
      if (realTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = realTmp;
      rmSync(ownTmp, { recursive: true, force: true });
    });
    const sink = { ...s, setupTiming: { mark: vi.fn() }, bindCasObservations: vi.fn() } as unknown as TurnSink;
    await expect(
      installGate(input, sink, { isReinvocation: false, adjudicatedApprovals: [], adjudicatedContentDigests: new Map(), adjudicatedHookAsks: new Set() }, newTurnStreamState(), hooks),
    ).rejects.toThrow();
    expect(readdirSync(ownTmp).filter((name) => name.startsWith("stigmer-hooks-")), "no hook server's directory is left behind").toEqual([]);
    expect(existsSync(join(dir, ".cursor"))).toBe(true);
  });
});
