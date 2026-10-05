/**
 * Pins the one runtime edge a slow hook meets: the turn's stall watchdog
 * (`shared/stall-watchdog.ts`). A PreToolUse hook runs before its tool
 * starts, so nothing else reports activity while it lives; its pulses
 * (`run.ts`, a third of the stall timeout) do. Real timers, a real
 * watchdog, a real hook process: a hook that outlives a lowered stall
 * timeout still completes, and the same hook with no pulse would have been
 * stopped as a stall.
 */

import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { describe, expect, it, vi } from "vitest";
import { startStallWatchdog } from "../../stall-watchdog.js";
import { HookEvaluator } from "../evaluate.js";
import { HookSet } from "../hook-set.js";
import { activityPulseFor } from "../run.js";
import { NativeToolViews } from "../tool-view.js";

const STALL_MS = 600;

function slowHooks(onActivity: ((detail: string) => void) | undefined): HookEvaluator {
  return new HookEvaluator({
    set: HookSet.of([{
      source: { plugin: "slow", root: "/p", data: "/d", options: new Map() },
      groups: [create(HookGroupSchema, {
        event: "PreToolUse",
        matcher: "Bash",
        handlers: [create(HookHandlerSchema, { command: "sleep 1.5; printf '%s' '{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\"}}'" })],
      })],
    }]),
    views: new NativeToolViews({
      workspaceRoot: process.cwd(),
      toVirtualPath: () => undefined,
      toolServerMap: new Map(),
      pluginServers: new Map(),
      platformServerSlugs: new Set(),
    }),
    sessionId: "ses",
    workspaceRoot: process.cwd(),
    permissionMode: "default",
    baseEnv: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    homeDir: process.cwd(),
    leases: new Set(),
    ...(onActivity ? { onActivity } : {}),
    activityPulseMs: activityPulseFor(STALL_MS),
  });
}

const SHELL = { id: "c", name: "execute", args: { command: "ls" }, serverSlug: "" };

describe("a hook that outlives the stall timeout", () => {
  it("keeps the turn alive with its pulses, and completes", async () => {
    const onStall = vi.fn();
    const watchdog = startStallWatchdog(STALL_MS, onStall);
    try {
      const outcome = await slowHooks(() => watchdog.recordActivity()).preToolUse(SHELL, {});
      expect(outcome.decision).toBe("allow");
      expect(onStall).not.toHaveBeenCalled();
    } finally {
      watchdog.stop();
    }
  });

  it("would have been stopped as a stall without them", async () => {
    const onStall = vi.fn();
    const watchdog = startStallWatchdog(STALL_MS, onStall);
    try {
      await slowHooks(undefined).preToolUse(SHELL, {});
      expect(onStall).toHaveBeenCalledOnce();
    } finally {
      watchdog.stop();
    }
  });
});
