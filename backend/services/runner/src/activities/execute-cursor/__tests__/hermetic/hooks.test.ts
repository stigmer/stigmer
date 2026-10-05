/**
 * Hermetic: an agent with hooks on the Cursor engine, through the whole
 * `ExecuteCursor` activity. The Cursor harness declares `runsHooks: false`,
 * so the runtime refuses the turn right after the blueprint, naming each hook
 * source, before any workspace, plugin or agent exists: run without them, the
 * hooks would be policies that silently vanished. The refusal settles as the
 * native engine's refusals do: EXECUTION_FAILED on the actionable surface,
 * its own sentence as `status.error`, and the one `Execution failed:` row.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { HookConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { ScriptedCursorAgent } from "../../__test-utils__/scripted-agent.js";
import { SDK_CATALOG, beginCursorScenario, cursorExecutionRecord, runCursorTurn } from "../../__test-utils__/hermetic-cursor.js";

describe("ExecuteCursor hermetic — an agent with hooks", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("is refused, naming its hook sources, before any plugin or agent exists", async () => {
    const getPluginByReference = vi.fn();
    const scenario = beginCursorScenario({
      env,
      clock,
      record: cursorExecutionRecord({
        message: "Clean the build.",
        hooks: [
          create(HookSourceSchema, { source: { case: "plugin", value: create(ApiResourceReferenceSchema, { kind: 58, org: "hermetic-org", slug: "safety" }) } }),
          create(HookSourceSchema, { source: { case: "inline", value: create(HookConfigSchema, {}) } }),
        ],
      }),
      sdk: { agents: [new ScriptedCursorAgent({ agentId: "agent-hooks-never", turns: [] })], catalog: SDK_CATALOG },
      clientOverrides: { getPluginByReference },
    });

    const invocation = await runCursorTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_FAILED");
    const final = scenario.record.lastFullStatus!;
    expect(final.error).toBe(
      "The agent has hooks (the plugin 'safety', its own hooks block), and this engine does not run hooks yet. " +
        "Run the agent on Stigmer's native engine, or remove its hooks.",
    );
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      `Execution failed: ${final.error}`,
    ]);
    expect(getPluginByReference, "no plugin was read").not.toHaveBeenCalled();
    expect(scenario.sdk.resolutions, "the SDK was never reached").toHaveLength(0);
  });
});
