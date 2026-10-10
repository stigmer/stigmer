/**
 * Pins the runtime's hook phases (`turn-context.ts`):
 *  - `refuseUnrunnableHooks`: an agent with hooks on an engine whose
 *    `capabilities.runsHooks` is false is refused by name, before anything
 *    is fetched; an agent without hooks, or a harness that runs them, passes;
 *  - `resolveHooks`: each source in the agent's order, a plugin read by
 *    reference and mounted from its verified archive, the agent's own block
 *    taken as written, each with the format it is written in (both run); a
 *    plugin with no hooks contributes none; an unreadable plugin, an archive
 *    that fails to mount and a plugin server that cannot be named each
 *    refuse the turn by name;
 *    a transient fault (the server unreachable, a download that failed in
 *    transit) is thrown instead, as the infrastructure's, never the owner's;
 *    every server a plugin brought is named as Claude Code names it.
 *
 * The client is doubled with scripted plugins; `HOME` is the hermetic
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
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { refuseUnrunnableHooks, resolveHooks, type ResolutionDeps } from "../turn-context.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

const ARCHIVE = buildZip([{ name: "hooks/hooks.json", content: '{"hooks":{}}' }]);
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");

const group = create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: "check" })] });

function pluginRef(slug: string): HookSource {
  return create(HookSourceSchema, { source: { case: "plugin", value: create(ApiResourceReferenceSchema, { kind: 58, org: "kit-org", slug }) } });
}
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

function clientWith(plugins: readonly Plugin[]) {
  return mockStigmerClient({
    getPluginByReference: vi.fn(async (ref: ApiResourceReference) => {
      const found = plugins.find((p) => p.metadata?.slug === ref.slug);
      if (found === undefined) throw new ConnectError(`plugin ${ref.slug} not found`, Code.NotFound);
      return found;
    }),
    getPlugin: vi.fn(async (id: string) => {
      const found = plugins.find((p) => p.metadata?.id === id);
      if (found === undefined) throw new ConnectError(`plugin ${id} not found`, Code.NotFound);
      return found;
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

function blueprintWith(hooks: HookSource[]) {
  const base = turnInputFixture().blueprint;
  return { ...base, agent: { ...base.agent!, spec: create(AgentSpecSchema, { instructions: "You are the fixture agent.", hooks }) } };
}

const server = (slug: string, origin: ResolvedMcpServer["pluginOrigin"]): ResolvedMcpServer => ({
  slug,
  connectionType: "stdio",
  destructiveTools: [],
  discoveredToolNames: null,
  discoveredCapabilitiesEmpty: false,
  serverId: "",
  pluginOrigin: origin,
});

describe("refuseUnrunnableHooks", () => {
  it("refuses an agent's hooks on an engine that does not run them, naming each source", () => {
    expect(refuseUnrunnableHooks(blueprintWith([pluginRef("safety"), inline()]), { runsHooks: false })).toEqual({
      kind: "hooks-refused",
      message:
        "The agent has hooks (the plugin 'safety', its own hooks block), and this engine does not run hooks yet. " +
        "Run the agent on Stigmer's native engine, or remove its hooks.",
    });
  });

  it("passes an agent without hooks, the built-in assistant, and an engine that runs hooks", () => {
    expect(refuseUnrunnableHooks(blueprintWith([]), { runsHooks: false })).toBeUndefined();
    expect(refuseUnrunnableHooks({ ...turnInputFixture().blueprint, agent: undefined }, { runsHooks: false })).toBeUndefined();
    expect(refuseUnrunnableHooks(blueprintWith([pluginRef("safety")]), { runsHooks: true })).toBeUndefined();
  });
});

describe("resolveHooks", () => {
  const run = (hooks: HookSource[], plugins: Plugin[], servers: ResolvedMcpServer[] = []) => {
    const { deps: d, labels } = deps(clientWith(plugins));
    return resolveHooks(d, { blueprint: blueprintWith(hooks), sessionId: `ses-hooks-${++session}`, servers }).then((r) => ({ r, labels }));
  };

  it("resolves nothing, and reports nothing, for an agent without hooks", async () => {
    const { r, labels } = await run([], []);
    expect(r).toEqual({ kind: "ready", hooks: { sources: [], pluginServers: new Map() } });
    expect(labels).toEqual([]);
  });

  it("mounts each referenced plugin and keeps the agent's order", async () => {
    const { r, labels } = await run([pluginRef("safety"), inline(), pluginRef("audit")], [plugin("safety"), plugin("audit")]);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.plugin?.slug ?? "own")).toEqual(["safety", "own", "audit"]);
    expect(r.hooks.sources[0]!.plugin?.root).toContain(DIGEST);
    expect(labels).toEqual(["Resolving hooks"]);
  });

  it("keeps each source's format: a plugin's recorded one, an own block's, Claude Code's when unset", async () => {
    const { r } = await run(
      [pluginRef("cursorish"), inline(HookFormat.CURSOR), inline(HookFormat.UNSPECIFIED), pluginRef("safety")],
      [plugin("cursorish", { format: HookFormat.CURSOR }), plugin("safety")],
    );
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.format)).toEqual(["cursor", "cursor", "claude-code", "claude-code"]);
  });

  it("passes over a source that names nothing (the proto's oneof rule refuses it at apply)", async () => {
    const { r } = await run([create(HookSourceSchema, {}), inline()], []);
    expect(r).toMatchObject({ kind: "ready" });
    if (r.kind !== "ready") return;
    expect(r.hooks.sources.map((s) => s.plugin)).toEqual([null]);
  });

  it("lets a plugin that records no hooks contribute none", async () => {
    const { r } = await run([pluginRef("quiet")], [plugin("quiet", { hooks: false })]);
    expect(r).toMatchObject({ kind: "ready", hooks: { sources: [] } });
  });

  it.each([
    ["a plugin that cannot be read", [pluginRef("gone")], [], "The plugin 'gone' that the agent's hooks reference could not be read"],
    ["an archive that does not verify", [pluginRef("forged")], [plugin("forged", { digest: "0".repeat(64) })], "the fetched archive does not match the installed version's digest"],
  ])("refuses %s, by name", async (_what, hooks, plugins, message) => {
    const { r } = await run(hooks, plugins);
    expect(r.kind).toBe("settled");
    if (r.kind !== "settled") return;
    expect(r.settlement).toMatchObject({ kind: "hooks-refused" });
    expect((r.settlement as { message: string }).message).toContain(message);
  });

  it("names every server a plugin brought as Claude Code does", async () => {
    const { r } = await run([inline()], [plugin("safety")], [
      server("safety-checks", { pluginId: "plg_safety", server: "checks" }),
      server("github", null),
    ]);
    expect(r).toMatchObject({ kind: "ready" });
    if (r.kind !== "ready") return;
    expect([...r.hooks.pluginServers]).toEqual([["safety-checks", { plugin: "safety-rails", server: "checks" }]]);
  });

  it("throws a transient fault instead of refusing the turn as the owner's to fix", async () => {
    const unavailable = () => new ConnectError("connection refused", Code.Unavailable);
    const resolve = (client: ResolutionDeps["client"], hooks: HookSource[], servers: ResolvedMcpServer[] = []) =>
      resolveHooks(deps(client).deps, { blueprint: blueprintWith(hooks), sessionId: `ses-hooks-${++session}`, servers });

    const unreachable = clientWith([plugin("safety")]);
    unreachable.getPluginByReference = vi.fn(async () => {
      throw unavailable();
    });
    await expect(resolve(unreachable, [pluginRef("safety")])).rejects.toThrow("connection refused");

    const inTransit = clientWith([plugin("safety")]);
    inTransit.getPluginArtifact = vi.fn(async () => {
      throw unavailable();
    });
    await expect(resolve(inTransit, [pluginRef("safety")])).rejects.toThrow("its archive could not be fetched");

    const ownerUnreachable = clientWith([plugin("safety")]);
    ownerUnreachable.getPlugin = vi.fn(async () => {
      throw unavailable();
    });
    await expect(resolve(ownerUnreachable, [inline()], [server("safety-checks", { pluginId: "plg_safety", server: "checks" })])).rejects.toThrow(
      "connection refused",
    );
  });

  it("refuses when a plugin server's plugin cannot be read", async () => {
    const { r } = await run([inline()], [], [server("orphan", { pluginId: "plg_gone", server: "s" })]);
    expect(r.kind).toBe("settled");
    if (r.kind !== "settled") return;
    expect((r.settlement as { message: string }).message).toContain("The MCP server 'orphan' came from a plugin that could not be read");
  });
});
