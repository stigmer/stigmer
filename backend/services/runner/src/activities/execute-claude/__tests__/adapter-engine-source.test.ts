/**
 * Pins where the Claude adapter's engine comes from at boot and on the first
 * turn (`adapter.ts`'s three states), with the finding, loading and
 * installing injected (`ClaudeBootDeps`) and the turn module mocked.
 *
 * - ready: an engine found at boot loads, a home's is stamped, and the ready
 *   line names where it came from;
 * - fetchable: a runner with a pin, not started from the runner layer and
 *   without an engine, downloads on its first Claude turn, showing the
 *   one-time label rising to 100%, loads the home and runs the turn; the
 *   second turn downloads nothing; a failed download ends the turn
 *   actionable with the download sentence and the next turn tries again; a
 *   stop during it ends the turn interrupted;
 * - absent: a runner started from the runner layer never fetches, tested as
 *   its agent host sees itself (uid 10001, where `agentIdentity()` is null,
 *   so that rule could not have kept it from fetching); nor does a runner
 *   without a pin, or with a broken one.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_MARKER, startFixtureRegistry } from "../../../__test-utils__/claude-engine-fixture.js";

import { testConfig } from "../../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { RUNNER_LAYER_ENV, agentIdentity } from "../../../shared/agent-identity.js";
import type { TurnOutcome } from "../../../harness/types.js";
import type { ClaudeBootDeps } from "../adapter.js";
import { CLAUDE_SDK, ENGINES_DIR_ENV, engineHomeDir, platformPackages, currentPlatform, type ClaudeEnginePin, type EngineSearch, type FoundEngine } from "../engine-home.js";
import type { ClaudeSdk } from "../turn.js";

const VERSION = "9.9.9-test";
const PIN: ClaudeEnginePin = {
  version: VERSION,
  packages: Object.fromEntries(
    [CLAUDE_SDK, ...platformPackages(currentPlatform())].map((name) => [name, { resolved: `https://registry.test/${name}.tgz`, integrity: "sha512-AAAA" }]),
  ),
};
const HOME_ENGINE: FoundEngine = { entry: "/engines/claude/9.9.9-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs", version: VERSION, home: "/engines/claude/9.9.9-test" };
const MISSING: EngineSearch = { kind: "missing", skipped: [] };
const FOUND: EngineSearch = { kind: "found", engine: HOME_ENGINE, skipped: [] };

const ran: { sdk: ClaudeSdk }[] = [];

beforeEach(() => {
  vi.resetModules();
  ran.length = 0;
  vi.doMock("../turn.js", () => ({
    runClaudeTurn: async (_input: unknown, _sink: unknown, _config: unknown, sdk: ClaudeSdk): Promise<TurnOutcome> => {
      ran.push({ sdk });
      return { kind: "completed" };
    },
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock("../turn.js");
  vi.restoreAllMocks();
});

async function adapterWith(overrides: Partial<ClaudeBootDeps>) {
  const { createClaudeAdapter } = await import("../adapter.js");
  const adapter = createClaudeAdapter({ env: {}, now: () => 0, ...overrides });
  await adapter.boot(testConfig());
  return adapter;
}

function logged(spy: "log" | "warn"): string[] {
  return vi.mocked(console[spy]).mock.calls.map((call) => String(call[0]));
}

describe("an engine found at boot", () => {
  it("loads it, stamps a home's use, logs where it came from, and runs every turn on it", async () => {
    const sdk = { marker: "home" } as unknown as ClaudeSdk;
    const load = vi.fn(async () => sdk);
    const adapter = await adapterWith({ readPin: () => PIN, find: () => FOUND, load });
    expect(load).toHaveBeenCalledWith(HOME_ENGINE);
    expect(logged("log")).toContain(`[claude] engine ready ${VERSION} (${HOME_ENGINE.home})`);
    await expect(adapter.runTurn(turnInputFixture(), new RecordingTurnSink())).resolves.toEqual({ kind: "completed" });
    expect(ran[0]?.sdk).toBe(sdk);
  });

  it("names every engine it skipped on the way", async () => {
    await adapterWith({ readPin: () => PIN, find: () => ({ ...FOUND, skipped: ["the runner's own install holds 1.0.0, not the pinned 9.9.9-test"] }), load: async () => ({}) as ClaudeSdk });
    expect(logged("warn")).toContain("[claude] skipped an engine: the runner's own install holds 1.0.0, not the pinned 9.9.9-test");
  });

  it("refuses Claude turns when the found engine fails to load", async () => {
    const adapter = await adapterWith({ readPin: () => PIN, find: () => FOUND, load: async () => Promise.reject(new Error("bad module")) });
    const { NOT_INSTALLED_MESSAGE } = await import("../adapter.js");
    expect(await adapter.runTurn(turnInputFixture(), new RecordingTurnSink())).toEqual({ kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE });
    expect(logged("warn").at(-1)).toContain("bad module");
  });
});

describe("a local runner without the engine", () => {
  it("downloads it on the first Claude turn, showing the one-time label, then loads the home and runs", async () => {
    const sdk = { marker: "downloaded" } as unknown as ClaudeSdk;
    let installed = false;
    let clock = 0;
    const install = vi.fn<ClaudeBootDeps["install"]>(async (_options, waiter) => {
      for (const fraction of [0.1, 0.105, 0.5, 0.75, 1]) {
        clock += 2_000;
        waiter.onActivity();
        waiter.onProgress(fraction);
      }
      installed = true;
      return { home: HOME_ENGINE.home as string, downloaded: true };
    });
    const adapter = await adapterWith({ readPin: () => PIN, find: () => (installed ? FOUND : MISSING), load: async () => sdk, install, now: () => clock });
    expect(logged("log").at(-1)).toMatch(new RegExp(`the first Claude turn downloads ${VERSION.replace(/\./g, "\\.")} into `));

    const sink = new RecordingTurnSink();
    await expect(adapter.runTurn(turnInputFixture(), sink)).resolves.toEqual({ kind: "completed" });
    expect(sink.progressLabels).toEqual([
      "Downloading Claude (one time): 0%",
      "Downloading Claude (one time): 10%",
      "Downloading Claude (one time): 50%",
      "Downloading Claude (one time): 75%",
      "Downloading Claude (one time): 100%",
    ]);
    expect(sink.activityMarks).toBe(5);
    expect(install.mock.calls[0]?.[0]).toMatchObject({ pin: PIN, platformPackage: platformPackages(currentPlatform())[0] });
    expect(ran[0]?.sdk).toBe(sdk);
    expect(logged("log")).toContain(`[claude] engine ready ${VERSION} (${HOME_ENGINE.home})`);

    const second = new RecordingTurnSink();
    await expect(adapter.runTurn(turnInputFixture(), second)).resolves.toEqual({ kind: "completed" });
    expect(install).toHaveBeenCalledTimes(1);
    expect(second.progressLabels).toEqual([]);
  });

  it("writes a label at most once a second while the percentage creeps", async () => {
    const install = vi.fn<ClaudeBootDeps["install"]>(async (_options, waiter) => {
      for (const fraction of [0.01, 0.02, 0.03]) waiter.onProgress(fraction);
      return { home: "/h", downloaded: true };
    });
    let installed = false;
    const adapter = await adapterWith({
      readPin: () => PIN,
      find: () => (installed ? FOUND : MISSING),
      load: async () => ({}) as ClaudeSdk,
      install: async (o, w) => {
        const r = await install(o, w);
        installed = true;
        return r;
      },
    });
    const sink = new RecordingTurnSink();
    await adapter.runTurn(turnInputFixture(), sink);
    expect(sink.progressLabels).toEqual(["Downloading Claude (one time): 0%"]);
  });

  it("ends a turn whose download failed actionable with the download sentence, and the next turn tries again", async () => {
    const { downloadFailedMessage } = await import("../adapter.js");
    let attempt = 0;
    let installed = false;
    const adapter = await adapterWith({
      readPin: () => PIN,
      find: () => (installed ? FOUND : MISSING),
      load: async () => ({}) as ClaudeSdk,
      install: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("failed to download the Claude engine: HTTP 404 from https://registry.test/x.tgz");
        installed = true;
        return { home: "/h", downloaded: true };
      },
    });
    const outcome = await adapter.runTurn(turnInputFixture(), new RecordingTurnSink());
    expect(outcome).toMatchObject({
      kind: "failed",
      surface: "actionable",
      message: downloadFailedMessage("failed to download the Claude engine: HTTP 404 from https://registry.test/x.tgz"),
    });
    expect(downloadFailedMessage("x")).toBe("Claude could not be downloaded to this computer (x). Check the connection and try again, or run this turn on another engine.");
    await expect(adapter.runTurn(turnInputFixture(), new RecordingTurnSink())).resolves.toEqual({ kind: "completed" });
    expect(attempt).toBe(2);
  });

  it("ends the turn interrupted when it is stopped during the download, and before it starts", async () => {
    const adapter = await adapterWith({
      readPin: () => PIN,
      find: () => MISSING,
      load: async () => ({}) as ClaudeSdk,
      install: (_options, waiter) =>
        new Promise((_resolve, reject) => waiter.signal.addEventListener("abort", () => reject(waiter.signal.reason), { once: true })),
    });
    const sink = new RecordingTurnSink();
    const turn = adapter.runTurn(turnInputFixture(), sink);
    await new Promise((resolve) => setTimeout(resolve, 10));
    sink.abort(new Error("paused"));
    await expect(turn).resolves.toEqual({ kind: "interrupted" });

    const stopped = new RecordingTurnSink();
    stopped.abort(new Error("already"));
    await expect(adapter.runTurn(turnInputFixture(), stopped)).resolves.toEqual({ kind: "interrupted" });
  });

  it("fails the turn when the installed home does not load", async () => {
    const adapter = await adapterWith({
      readPin: () => PIN,
      find: () => ({ kind: "missing", skipped: ["/h: no executable for linux-x64 in it"] }),
      load: async () => ({}) as ClaudeSdk,
      install: async () => ({ home: "/h", downloaded: true }),
    });
    const outcome = await adapter.runTurn(turnInputFixture(), new RecordingTurnSink());
    expect(outcome).toMatchObject({ kind: "failed", surface: "actionable" });
    expect((outcome as { message: string }).message).toContain("the downloaded engine at /h did not load: /h: no executable for linux-x64 in it");
  });

  it("refuses when the pin carries no package for this machine", async () => {
    const { NOT_INSTALLED_MESSAGE } = await import("../adapter.js");
    const install = vi.fn<ClaudeBootDeps["install"]>();
    const adapter = await adapterWith({
      readPin: () => ({ version: VERSION, packages: { [CLAUDE_SDK]: { resolved: "u", integrity: "i" } } }),
      find: () => MISSING,
      install,
    });
    expect(await adapter.runTurn(turnInputFixture(), new RecordingTurnSink())).toEqual({ kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE });
    expect(install).not.toHaveBeenCalled();
  });
});

describe("a runner that must not fetch", () => {
  it("never fetches when started from the runner layer, though its agent host is not root", async () => {
    // What the separated host sees: uid 10001 with the layer's marker, where
    // agentIdentity() is null, so it could not have told this host apart.
    expect(agentIdentity({ platform: "linux", uid: 10001, env: { [RUNNER_LAYER_ENV]: "1" } })).toBeNull();
    const { NOT_INSTALLED_MESSAGE } = await import("../adapter.js");
    const install = vi.fn<ClaudeBootDeps["install"]>();
    const adapter = await adapterWith({ env: { [RUNNER_LAYER_ENV]: "1" }, readPin: () => PIN, find: () => MISSING, install });
    const sink = new RecordingTurnSink();
    expect(await adapter.runTurn(turnInputFixture(), sink)).toEqual({ kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE });
    expect(install).not.toHaveBeenCalled();
    expect(sink.progressLabels).toEqual([]);
    expect(logged("warn").at(-1)).toContain("Claude turns will be refused: no engine 9.9.9-test under ");
  });

  it("refuses without a pin, naming the missing install, and on a broken pin, naming it", async () => {
    const install = vi.fn<ClaudeBootDeps["install"]>();
    const unpinned = await adapterWith({ readPin: () => null, find: () => MISSING, install });
    expect(await unpinned.runTurn(turnInputFixture(), new RecordingTurnSink())).toMatchObject({ kind: "failed", surface: "actionable" });
    expect(logged("warn").at(-1)).toContain(`${CLAUDE_SDK} is not installed beside the runner`);

    const broken = await adapterWith({
      readPin: () => {
        throw new Error("/runner/dist/claude-engine.json is not a Claude engine pin");
      },
      install,
    });
    expect(await broken.runTurn(turnInputFixture(), new RecordingTurnSink())).toMatchObject({ kind: "failed", surface: "actionable" });
    expect(logged("warn").at(-1)).toContain("is not a Claude engine pin");
    expect(install).not.toHaveBeenCalled();
  });
});

describe("a local runner's first Claude turn, with nothing injected but its pin", () => {
  it("downloads the engine its pin names from the registry, loads it from the home and runs the turn on it", async () => {
    const registry = await startFixtureRegistry(VERSION, platformPackages(currentPlatform())[0] as string);
    const root = mkdtempSync(join(tmpdir(), "claude-adapter-engines-"));
    try {
      const { createClaudeAdapter } = await import("../adapter.js");
      const adapter = createClaudeAdapter({ env: { [ENGINES_DIR_ENV]: root }, readPin: () => registry.pin });
      await adapter.boot(testConfig());
      const sink = new RecordingTurnSink();
      await expect(adapter.runTurn(turnInputFixture(), sink)).resolves.toEqual({ kind: "completed" });
      expect((ran[0]?.sdk as unknown as { marker: string }).marker).toBe(FIXTURE_MARKER);
      expect(sink.progressLabels.at(-1)).toBe("Downloading Claude (one time): 100%");
      expect(logged("log")).toContain(`[claude] engine ready ${VERSION} (${engineHomeDir(root, VERSION)})`);
    } finally {
      await registry.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
