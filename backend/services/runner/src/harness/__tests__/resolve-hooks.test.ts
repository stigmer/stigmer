/**
 * Pins the runtime's hook phases (`turn-context.ts`):
 *  - `refuseUnrunnableHooks`: a turn with hooks (its plugins' or the agent's
 *    own block) on an engine whose `capabilities.runsHooks` is false is
 *    refused naming each source, before anything is fetched; a turn without
 *    hooks, or a harness that runs them, passes;
 *  - `resolveHooks`: the turn's plugins that record hooks first, in the
 *    blueprint's merge order, each mounted from its verified archive, then
 *    the agent's own block, taken as written, each with the format it is
 *    written in (both run); a chat with the built-in assistant (no agent)
 *    gets its plugins' hooks too; a plugin with no hooks contributes none;
 *    an archive that fails to verify refuses the turn naming the plugin; a
 *    transient fault is thrown instead, as the infrastructure's, never the
 *    owner's; every plugin server is named from its resolved origin, as
 *    Claude Code names it, without a read of the control plane.
 *
 * The client is doubled with a scripted archive; `HOME` is the hermetic
 * environment's, so mounts land under a temporary platform dir.
 */
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentSpecSchema, HookSourceSchema, type HookSource } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { GetArtifactResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import type { ResolvedBlueprint } from "../../shared/blueprint-resolver.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { refuseUnrunnableHooks, resolveHooks, type ResolutionDeps } from "../turn-context.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

const ARCHIVE = buildZip([{ name: "hooks/hooks.json", content: '{"hooks":{}}' }]);
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");

const group = create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: "check" })] });

const inline = (format = HookFormat.CLAUDE_CODE): HookSource =>
  create(HookSourceSchema, { source: { case: "inline", value: create(HookConfigSchema, { format, groups: [group] }) } });

function plugin(slug: string, options: { format?: HookFormat; hooks?: boolean; digest?: string } = {}): Plugin {
  return create(PluginSchema, {
    metadata: { id: `plg_${slug}`, slug, name: `${slug}-rails` },
    status: {
      digest: options.digest ?? DIGEST,
      artifactStorageKey: `plugins/${slug}.zip`,
      ...(options.hooks === false ? {} : { hooks: create(HookConfigSchema, { format: options.format ?? HookFormat.CLAUDE_CODE, groups: [group] }) }),
    },
  });
}

function client() {
  return mockStigmerClient({
    getPluginByReference: vi.fn(async () => {
      throw new Error("resolveHooks must not read a plugin: the blueprint carries it");
    }),
    getPlugin: vi.fn(async () => {
      throw new Error("resolveHooks must not read a plugin: the blueprint carries it");
    }),
    getPluginArtifactDownloadUrl: vi.fn(async () => {
      throw new ConnectError("no lane", Code.Unimplemented);
    }),
    getPluginArtifact: vi.fn(async () => create(GetArtifactResponseSchema, { artifact: ARCHIVE })),
  });
}

let session = 0;
function deps(client: ResolutionDeps["client"]): { deps: ResolutionDeps; labels: string[] } {
  const labels: string[] = [];
  const status = create(RunStatusSchema, {});
  return {
    labels,
    deps: {
      input: { executionId: "aex-hooks", threadId: "", turnSeq: 0 },
      client,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir }),
      status,
      transcript: new TranscriptBuilder("aex-hooks", status),
      artifactStorage: undefined,
      timing: new TimingRecorder(),
      signal: new AbortController().signal,
      heartbeat: () => {},
      enterPhase: () => {},
      reportProgress: async (label) => {
        labels.push(label);
      },
    },
  };
}

/** The fixture's blueprint with these plugins, and an agent with this own hooks block (`null`: the built-in assistant). */
function blueprintWith(plugins: Plugin[], hooks: HookSource[] | null = []): ResolvedBlueprint {
  const base = turnInputFixture().blueprint;
  return {
    ...base,
    plugins,
    agent: hooks === null ? undefined : { ...base.agent!, spec: create(AgentSpecSchema, { instructions: "You are the fixture agent.", hooks }) },
  };
}

const server = (slug: string, origin: ResolvedMcpServer["pluginOrigin"]): ResolvedMcpServer => ({
  slug,
  connectionType: "stdio",
  pluginOrigin: origin,
});

describe("refuseUnrunnableHooks", () => {
  it("refuses a turn's hooks on an engine that does not run them, naming each source", () => {
    expect(refuseUnrunnableHooks(blueprintWith([plugin("safety"), plugin("quiet", { hooks: false })], [inline()]), { runsHooks: false })).toEqual({
      kind: "hooks-refused",
      message:
        "This conversation has hooks (the plugin 'safety-rails', the agent's own hooks block), and this engine does not run hooks yet. " +
        "Run it on Stigmer's native engine, or remove the hooks.",
    });
  });

  it("counts a plugin's hooks on a chat with the built-in assistant", () => {
    expect(refuseUnrunnableHooks(blueprintWith([plugin("safety")], null), { runsHooks: false })).toMatchObject({ kind: "hooks-refused" });
  });

  it("passes a turn without hooks, the bare built-in assistant, and an engine that runs hooks", () => {
    expect(refuseUnrunnableHooks(blueprintWith([plugin("quiet", { hooks: false })]), { runsHooks: false })).toBeUndefined();
    expect(refuseUnrunnableHooks(blueprintWith([], null), { runsHooks: false })).toBeUndefined();
    expect(refuseUnrunnableHooks(blueprintWith([plugin("safety")], [inline()]), { runsHooks: true })).toBeUndefined();
  });
});

describe("resolveHooks", () => {
  const run = (blueprint: ResolvedBlueprint, servers: ResolvedMcpServer[] = []) => {
    const { deps: d, labels } = deps(client());
    return resolveHooks(d, { blueprint, sessionId: `ses-hooks-${++session}`, servers }).then((r) => ({ r, labels }));
  };

  it("resolves nothing, and reports nothing, for a turn without hooks", async () => {
    const { r, labels } = await run(blueprintWith([plugin("quiet", { hooks: false })]));
    expect(r).toEqual({ kind: "ready", hooks: { sources: [], pluginServers: new Map() } });
    expect(labels).toEqual([]);
  });

  it("mounts each plugin with hooks, in merge order, ahead of the agent's own block", async () => {
    const { r, labels } = await run(blueprintWith([plugin("safety"), plugin("quiet", { hooks: false }), plugin("audit")], [inline()]));
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.plugin?.slug ?? "own")).toEqual(["safety", "audit", "own"]);
    expect(r.hooks.sources[0]!.plugin?.root).toContain(DIGEST);
    expect(r.hooks.sources[0]!.plugin?.id, "the id a plugin's hook values are grouped by").toBe("plg_safety");
    expect(labels).toEqual(["Resolving hooks"]);
  });

  it("runs a plugin's hooks on a chat with the built-in assistant (no agent)", async () => {
    const { r } = await run(blueprintWith([plugin("safety")], null));
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.plugin?.slug)).toEqual(["safety"]);
  });

  it("keeps each source's format: a plugin's recorded one, an own block's, Claude Code's when unset", async () => {
    const { r } = await run(
      blueprintWith([plugin("cursorish", { format: HookFormat.CURSOR }), plugin("safety")], [inline(HookFormat.CURSOR), inline(HookFormat.UNSPECIFIED)]),
    );
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.format)).toEqual(["cursor", "claude-code", "cursor", "claude-code"]);
  });

  it("passes over an own source that names nothing (the proto's oneof rule refuses it at apply)", async () => {
    const { r } = await run(blueprintWith([], [create(HookSourceSchema, {}), inline()]));
    expect(r).toMatchObject({ kind: "ready" });
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.plugin)).toEqual([null]);
  });

  it("refuses an archive that does not verify, naming the plugin", async () => {
    const { r } = await run(blueprintWith([plugin("forged", { digest: "0".repeat(64) })]));
    expect(r.kind).toBe("settled");
    if (r.kind !== "settled") return;
    expect(r.settlement).toMatchObject({ kind: "hooks-refused" });
    const message = (r.settlement as { message: string }).message;
    expect(message).toContain("The hooks of plugin 'forged-rails' could not be prepared");
    expect(message).toContain("the fetched archive does not match the installed version's digest");
  });

  it("names every plugin server from its resolved origin, as Claude Code does", async () => {
    const { r } = await run(blueprintWith([], [inline()]), [
      server("plugin_safety-rails_checks", { pluginId: "plg_safety", plugin: "safety-rails", server: "checks" }),
      server("stigmer-memory", null),
    ]);
    expect(r).toMatchObject({ kind: "ready" });
    if (r.kind !== "ready") return;
    expect([...r.hooks.pluginServers]).toEqual([["plugin_safety-rails_checks", { plugin: "safety-rails", server: "checks" }]]);
  });

  it("throws a transient fault instead of refusing the turn as the owner's to fix", async () => {
    const inTransit = client();
    inTransit.getPluginArtifact = vi.fn(async () => {
      throw new ConnectError("connection refused", Code.Unavailable);
    });
    await expect(
      resolveHooks(deps(inTransit).deps, { blueprint: blueprintWith([plugin("safety")]), sessionId: `ses-hooks-${++session}`, servers: [] }),
    ).rejects.toThrow("its archive could not be fetched");
  });
});
