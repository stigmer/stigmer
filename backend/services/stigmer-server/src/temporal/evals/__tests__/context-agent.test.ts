/**
 * Pins an eval run's context about an agent (context.ts), over a real
 * store and a real suite read by `readEvalSuite`:
 *
 *   - a stamped eval run reads the agent at its version and the plugin at
 *     its stamped digest, with the agent as it runs for its default target,
 *     and with no plugin compared plans one arm and leaves nothing out;
 *   - comparing the attached plugin plans both arms, the without arm's
 *     try listing the plugin all the same and leaving it out;
 *   - the servers the agent version writes itself are among the servers a
 *     try runs beside its case's plugin, so a try turns them off unless
 *     the eval runs real servers;
 *   - the loader answers undefined for an eval run stored with no spec,
 *     and for one whose stamped plugin versions is gone, reading no suite,
 *     so a try has nothing it may run as stamped;
 *   - a store fault reading the agent's version is thrown, never taken for
 *     a version gone, so the activity is retried.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { attachmentOf, newEvalContextLoader, otherServersOf } from "../context.js";
import { tryToolsOf } from "../../../domain/eval-run/try-run.js";
import {
  AGENT_EVAL_RUN_ID,
  AGENT_HASH,
  DIGEST,
  MODEL,
  ORG,
  PLUGIN_ID,
  catalog,
  seedAgent,
  seedEvalRunOnAgent,
  seedPlugin,
  suiteSource,
} from "./support.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function loader(source: ReturnType<typeof suiteSource> = suiteSource(), store: Store = temp.store) {
  return newEvalContextLoader({ store, suites: source, catalog });
}

/** A store whose reads of `kind` fail with a fault that is not "not found". */
function faultyReadsOf(kind: ApiResourceKind): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === "getResource") {
        const read: Store["getResource"] = (readKind, id, schema) =>
          readKind === kind
            ? Promise.reject(new Error("the database is unreachable"))
            : target.getResource(readKind, id, schema);
        return read;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("an eval run's context about an agent", () => {
  it("reads the agent at its version and each plugin at its stamped digest", async () => {
    await seedAgent(temp.store);
    await seedPlugin(temp.store);
    await seedEvalRunOnAgent(temp.store);
    const source = suiteSource();
    const context = await loader(source)(AGENT_EVAL_RUN_ID);
    if (context === undefined) throw new Error("no context");
    expect(context.agent).toEqual({ org: ORG, id: "agt_1", slug: "support-desk", versionHash: AGENT_HASH });
    expect(context.sources.map((entry) => [entry.digest, entry.pluginIndex])).toEqual([[DIGEST, 0]]);
    expect(context.matrix.cases[0]?.targets[0]?.target).toMatchObject({ harness: Harness.NATIVE, modelName: MODEL });
    expect([context.comparedPluginId, context.twoArms]).toEqual([undefined, false]);
    expect(context.matrix.cells.every((cell) => cell.arm === "with")).toBe(true);
    expect(attachmentOf(context, "with").excludedPluginIds).toEqual([]);
    expect(source.reads).toBe(1);
  });

  it("plans both arms when it compares the attached plugin, the without arm listing it and leaving it out", async () => {
    await seedAgent(temp.store);
    await seedPlugin(temp.store);
    await seedEvalRunOnAgent(temp.store, { compared: true });
    const context = await loader()(AGENT_EVAL_RUN_ID);
    if (context === undefined) throw new Error("no context");
    expect([context.comparedPluginId, context.twoArms]).toEqual([PLUGIN_ID, true]);
    expect(new Set(context.matrix.cells.map((cell) => cell.arm))).toEqual(new Set(["with", "without"]));
    const without = attachmentOf(context, "without");
    const withIt = attachmentOf(context, "with");
    expect(without.plugins.map((ref) => ref.id)).toEqual([PLUGIN_ID]);
    expect(withIt.plugins).toEqual(without.plugins);
    expect(without.agentRef).toEqual(withIt.agentRef);
    expect([withIt.excludedPluginIds, without.excludedPluginIds]).toEqual([[], [PLUGIN_ID]]);
  });

  it("counts the agent's own servers among those a try turns off, unless the eval runs real servers", async () => {
    await seedAgent(temp.store, { mcpServers: [{ name: "zendesk", url: "https://acme-co.zendesk.com/mcp" }] });
    await seedPlugin(temp.store);
    await seedEvalRunOnAgent(temp.store);
    const context = await loader()(AGENT_EVAL_RUN_ID);
    if (context === undefined) throw new Error("no context");
    expect(context.ownServers).toEqual([{ slug: "zendesk", key: "zendesk" }]);
    const others = otherServersOf(context, 0);
    expect(others).toContainEqual({ slug: "zendesk", key: "zendesk" });
    const evalCase = { allowedTools: [], mocks: [] };
    const knobs = { allowTools: [], realMcpServers: false, allowRealServers: false };
    expect(tryToolsOf(evalCase, knobs, [], true, others).disallowedTools).toContain("mcp__zendesk");
    expect(tryToolsOf(evalCase, { ...knobs, realMcpServers: true }, [], true, others).disallowedTools).not.toContain("mcp__zendesk");
    expect(tryToolsOf(evalCase, { ...knobs, allowRealServers: true }, [], true, others).disallowedTools).not.toContain("mcp__zendesk");
  });

  it("is undefined for an eval run stored with no spec, reading no suite", async () => {
    await seedAgent(temp.store);
    await seedPlugin(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.eval_run,
      AGENT_EVAL_RUN_ID,
      EvalRunSchema,
      create(EvalRunSchema, { metadata: { id: AGENT_EVAL_RUN_ID, org: ORG, name: AGENT_EVAL_RUN_ID } }),
    );
    const source = suiteSource();
    expect(await loader(source)(AGENT_EVAL_RUN_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("is undefined when a stamped plugin version is gone, reading no suite", async () => {
    await seedAgent(temp.store);
    await seedPlugin(temp.store);
    await seedEvalRunOnAgent(temp.store, { pluginDigest: "9".repeat(64) });
    const source = suiteSource();
    expect(await loader(source)(AGENT_EVAL_RUN_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("throws a store fault reading the agent's version rather than answering it gone", async () => {
    await seedAgent(temp.store);
    await seedPlugin(temp.store);
    await seedEvalRunOnAgent(temp.store);
    const thrown = await loader(suiteSource(), faultyReadsOf(ApiResourceKind.agent))(AGENT_EVAL_RUN_ID).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(ConnectError);
    expect(ConnectError.from(thrown).code).toBe(Code.Internal);
  });
});
