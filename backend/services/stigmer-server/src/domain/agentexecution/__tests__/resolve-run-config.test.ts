/**
 * Pins ResolveRunConfig (resolve-run-config.ts): the one place a turn's
 * settings are resolved.
 *
 * The rule (resolveRunConfig, a table): the model from the first layer
 * naming one; tier and thinking from that layer or a more specific one,
 * never below it, and from the turn alone when no layer names a model; each
 * bound the smallest positive value any layer sets; zero and empty never
 * count; the layer each choice came from is reported.
 *
 * The agent layer (agentLayerFor) whole on the engine the agent names and
 * bounds-only on the other, and the conversation's engine
 * (conversationHarness): a stored session's, else the request's, else the
 * agent's, else native.
 *
 * The step, over a real SQLite store: it reads the run defaults of the
 * agent version the turn is stamped with (an archived version, not the
 * head); places the turn on its lane (an edition lane first, replacing the
 * request's settings; the schedule label with its profile and UNATTENDED;
 * a workflow parent INTERACTIVE; everything else INTERACTIVE); stamps
 * status.run_config and status.approval_mode, overwriting anything there;
 * and refuses an unattended Cursor turn that would run with no model, while
 * passing an attended one. reResolveRunConfig resolves again over another
 * pinned version and leaves an unchanged pin alone; CreateSessionIfNeeded
 * judges the re-resolved settings by the same checks (a fast tier the new
 * version cannot price, an unattended Cursor turn left with no model).
 * Refusals name the layer that chose each value, the profile and "no
 * layer" included. A surface's saved settings that set a tier or thinking
 * with no model of their own are refused; a live message may set either
 * alone.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  RunConfigSchema,
  type RunConfig,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import type { RunLanes } from "../../../extensions/run-lanes.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import { createLogger } from "../../../boot/logger.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import { newCreateSessionIfNeededStep } from "../create-steps.js";
import { serviceTierRefusal } from "../validate-service-tier.js";
import {
  agentLayerFor,
  conversationHarness,
  newResolveRunConfigStep,
  reResolveRunConfig,
  resolveRunConfig,
  runConfigLayerName,
  runConfigPlacementOf,
} from "../resolve-run-config.js";

const REGISTRY = new ModelRegistryStore({
  bundledDocument: bundledModelRegistryDocument(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: createLogger({ level: "error", pretty: false, write: () => {} }),
});
import { SCHEDULE_ID_LABEL_KEY } from "../run-person.js";

type RunConfigInit = MessageInitShape<typeof RunConfigSchema>;
type TargetInit = NonNullable<
  MessageInitShape<typeof AgentExecutionSchema>["spec"]
>["target"];

function rc(init: RunConfigInit): RunConfig {
  return create(RunConfigSchema, init);
}

describe("resolveRunConfig: choices from the most specific layer naming one", () => {
  it.each<[string, RunConfigInit | undefined, RunConfigInit | undefined, RunConfigInit | undefined, RunConfigInit, Record<string, string | undefined>]>([
    [
      "nothing set anywhere leaves everything to the engine",
      undefined,
      undefined,
      undefined,
      {},
      { model: undefined, serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "the turn's model wins over the agent's and the profile's",
      { modelName: "turn-model" },
      { modelName: "agent-model" },
      { modelName: "profile-model" },
      { modelName: "turn-model" },
      { model: "turn", serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "the agent's model wins over the profile's",
      {},
      { modelName: "agent-model" },
      { modelName: "profile-model" },
      { modelName: "agent-model" },
      { model: "agent", serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "the profile's model is the last fallback",
      undefined,
      undefined,
      { modelName: " profile-model " },
      { modelName: "profile-model" },
      { model: "profile", serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "the agent's tier and thinking ride with the agent's model",
      {},
      {
        modelName: "agent-model",
        serviceTier: ServiceTier.FAST,
        thinkingMode: ThinkingMode.ENABLED,
      },
      { modelName: "profile-model" },
      {
        modelName: "agent-model",
        serviceTier: ServiceTier.FAST,
        thinkingMode: ThinkingMode.ENABLED,
      },
      { model: "agent", serviceTier: "agent", thinkingMode: "agent" },
    ],
    [
      "a message turns the agent's thinking off for its model alone",
      { thinkingMode: ThinkingMode.DISABLED },
      { modelName: "agent-model", thinkingMode: ThinkingMode.ENABLED },
      undefined,
      { modelName: "agent-model", thinkingMode: ThinkingMode.DISABLED },
      { model: "agent", serviceTier: undefined, thinkingMode: "turn" },
    ],
    [
      "a less specific layer's tier never lands on a more specific layer's model",
      { modelName: "turn-model" },
      { modelName: "agent-model", serviceTier: ServiceTier.FAST, thinkingMode: ThinkingMode.ENABLED },
      undefined,
      { modelName: "turn-model" },
      { model: "turn", serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "the profile's tier never lands on the agent's model",
      {},
      { modelName: "agent-model" },
      { modelName: "profile-model", serviceTier: ServiceTier.FAST },
      { modelName: "agent-model" },
      { model: "agent", serviceTier: undefined, thinkingMode: undefined },
    ],
    [
      "with no model, tier and thinking come from the turn alone",
      { thinkingMode: ThinkingMode.ENABLED },
      { serviceTier: ServiceTier.FAST },
      { thinkingMode: ThinkingMode.DISABLED },
      { thinkingMode: ThinkingMode.ENABLED },
      { model: undefined, serviceTier: undefined, thinkingMode: "turn" },
    ],
  ])("%s", (_, turn, agent, profile, want, chosenBy) => {
    const resolved = resolveRunConfig(
      turn === undefined ? undefined : rc(turn),
      agent === undefined ? undefined : rc(agent),
      profile === undefined ? undefined : rc(profile),
    );
    expect(resolved.config).toEqual(rc(want));
    expect(resolved.chosenBy).toEqual(chosenBy);
  });
});

describe("resolveRunConfig: bounds are the tightest any layer sets", () => {
  it.each<[string, RunConfigInit, RunConfigInit, RunConfigInit, RunConfigInit]>([
    [
      "a profile is a ceiling the turn cannot raise",
      { maxCostUsd: 5, maxToolRounds: 50, maxToolResultChars: 90_000 },
      {},
      { maxCostUsd: 1, maxToolRounds: 20, maxToolResultChars: 30_000 },
      { maxCostUsd: 1, maxToolRounds: 20, maxToolResultChars: 30_000 },
    ],
    [
      "a message lowers the agent's cap",
      { maxCostUsd: 0.5 },
      { maxCostUsd: 2 },
      {},
      { maxCostUsd: 0.5 },
    ],
    [
      "a message cannot raise the agent's cap",
      { maxCostUsd: 10, maxToolRounds: 500 },
      { maxCostUsd: 2, maxToolRounds: 40 },
      {},
      { maxCostUsd: 2, maxToolRounds: 40 },
    ],
    [
      "zero is unset on every layer",
      { maxCostUsd: 0, maxToolRounds: 0 },
      { maxCostUsd: 0, maxToolResultChars: 0 },
      { maxToolRounds: 20 },
      { maxToolRounds: 20 },
    ],
  ])("%s", (_, turn, agent, profile, want) => {
    expect(resolveRunConfig(rc(turn), rc(agent), rc(profile)).config).toEqual(rc(want));
  });
});

describe("agentLayerFor: an agent's choices count only on its engine", () => {
  const spec = create(AgentSpecSchema, {
    harness: Harness.CURSOR,
    runConfig: {
      modelName: "claude-opus-4-6",
      serviceTier: ServiceTier.FAST,
      thinkingMode: ThinkingMode.ENABLED,
      maxCostUsd: 2,
      maxToolRounds: 30,
      maxToolResultChars: 40_000,
    },
  });

  it("the whole defaults on the engine they name", () => {
    expect(agentLayerFor(spec, "cursor")).toEqual(spec.runConfig);
  });

  it("only the bounds on the other engine", () => {
    expect(agentLayerFor(spec, "native")).toEqual(
      rc({ maxCostUsd: 2, maxToolRounds: 30, maxToolResultChars: 40_000 }),
    );
  });

  it("an unset engine is native, and no defaults is no layer", () => {
    const native = create(AgentSpecSchema, { runConfig: { maxCostUsd: 1 } });
    expect(agentLayerFor(native, "native")).toEqual(native.runConfig);
    expect(agentLayerFor(create(AgentSpecSchema), "native")).toBeUndefined();
    expect(agentLayerFor(undefined, "native")).toBeUndefined();
  });
});

describe("conversationHarness", () => {
  const cursorAgent = create(AgentSpecSchema, { harness: Harness.CURSOR });

  function turn(target: TargetInit): AgentExecution {
    return create(AgentExecutionSchema, { spec: { message: "hi", target } });
  }

  it("a turn in a stored session runs the session's engine, whatever the agent names", () => {
    const stored = create(SessionSchema, { spec: { harness: Harness.NATIVE } });
    expect(
      conversationHarness(turn({ case: "sessionId", value: "ses_1" }), stored, cursorAgent),
    ).toBe("native");
  });

  it("a new conversation takes the request's engine, else the agent's, else native", () => {
    expect(
      conversationHarness(
        turn({ case: "sessionSpec", value: {} }),
        undefined,
        cursorAgent,
      ),
    ).toBe("cursor");
    expect(
      conversationHarness(
        turn({ case: "sessionSpec", value: { harness: Harness.NATIVE } }),
        undefined,
        cursorAgent,
      ),
    ).toBe("native");
    expect(conversationHarness(turn({ case: undefined }), undefined, cursorAgent)).toBe("cursor");
    expect(conversationHarness(turn({ case: undefined }), undefined, undefined)).toBe("native");
  });
});

describe("ResolveRunConfig over a real store", () => {
  const AGENT = "agt_reviewer";
  const HEAD = "c".repeat(64);
  const PINNED = "d".repeat(64);
  let dir: string;
  let store: Store;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "resolve-run-config-test-"));
    store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
      listIndexes: LIST_INDEXES,
    });
    // The pinned version: native, Sonnet, thinking on, a $2 cap. The head
    // has moved to another model since.
    await store.saveAudit(
      ApiResourceKind.agent,
      AGENT,
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: AGENT, org: "acme", slug: "reviewer" },
        spec: {
          harness: Harness.NATIVE,
          runConfig: {
            modelName: "claude-sonnet-5",
            thinkingMode: ThinkingMode.ENABLED,
            maxCostUsd: 2,
          },
        },
        status: { versionHash: PINNED },
      }),
      PINNED,
      "",
    );
    await store.saveResource(
      ApiResourceKind.agent,
      AGENT,
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: AGENT, org: "acme", slug: "reviewer" },
        spec: { harness: Harness.NATIVE, runConfig: { modelName: "claude-haiku-4.5" } },
        status: { versionHash: HEAD },
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function execution(init: MessageInitShape<typeof AgentExecutionSchema>): AgentExecution {
    return create(AgentExecutionSchema, init);
  }

  async function resolve(
    exec: AgentExecution,
    options: { runLanes?: RunLanes; scheduleProfile?: RunConfig } = {},
  ): Promise<RequestContext<typeof AgentExecutionSchema>> {
    const ctx = new RequestContext(
      AgentExecutionSchema,
      exec,
      testCallerIdentity(),
      ApiResourceKind.agent_execution,
    );
    ctx.setNewState(exec);
    await newResolveRunConfigStep({
      store,
      runLanes: options.runLanes,
      scheduleProfile: options.scheduleProfile,
    }).execute(ctx);
    return ctx;
  }

  it("reads the defaults of the version the turn runs, not the head", async () => {
    const ctx = await resolve(
      execution({
        spec: { message: "hi", target: { case: "sessionId", value: "ses_1" } },
        status: { agentId: AGENT, agentVersionHash: PINNED },
      }),
    );
    expect(ctx.newState.status?.runConfig).toEqual(
      rc({ modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED, maxCostUsd: 2 }),
    );
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
    expect(runConfigPlacementOf(ctx)?.resolution.chosenBy.model).toBe("agent");
  });

  it("overwrites a client-sent status run_config and approval mode", async () => {
    const ctx = await resolve(
      execution({
        spec: { message: "hi", runConfig: { modelName: "gpt-x" } },
        status: {
          runConfig: { modelName: "forged", maxCostUsd: 999 },
          approvalMode: ApprovalMode.UNATTENDED,
        },
      }),
    );
    expect(ctx.newState.status?.runConfig).toEqual(rc({ modelName: "gpt-x" }));
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
  });

  it("a schedule's turn is capped by the schedule profile and runs unattended", async () => {
    const ctx = await resolve(
      execution({
        metadata: { labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_1" } },
        spec: { message: "hi", runConfig: { maxToolRounds: 50, maxCostUsd: 0.25 } },
      }),
      { scheduleProfile: rc({ maxToolRounds: 20, maxCostUsd: 1 }) },
    );
    expect(ctx.newState.status?.runConfig).toEqual(rc({ maxToolRounds: 20, maxCostUsd: 0.25 }));
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.UNATTENDED);
  });

  it("a workflow step's turn takes its agent's caps and stays interactive", async () => {
    const ctx = await resolve(
      execution({
        spec: {
          message: "hi",
          parent: { workflowExecutionId: "wfx_1" },
          runConfig: { maxCostUsd: 5 },
        },
        status: { agentId: AGENT, agentVersionHash: PINNED },
      }),
    );
    expect(ctx.newState.status?.runConfig?.maxCostUsd).toBe(2);
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
  });

  it("an edition lane replaces the request's settings and supplies the profile and approval mode", async () => {
    const lanes: RunLanes = {
      laneOf: () =>
        Promise.resolve({
          settings: rc({ modelName: "claude-haiku-4.5" }),
          settingsName: "the share's run_config",
          profile: rc({ maxCostUsd: 0.5 }),
          approvalMode: ApprovalMode.UNATTENDED,
        }),
    };
    const ctx = await resolve(
      execution({
        spec: { message: "hi", runConfig: { modelName: "visitor-choice", maxCostUsd: 100 } },
      }),
      { runLanes: lanes },
    );
    expect(ctx.newState.spec?.runConfig).toEqual(rc({ modelName: "claude-haiku-4.5" }));
    expect(ctx.newState.status?.runConfig).toEqual(
      rc({ modelName: "claude-haiku-4.5", maxCostUsd: 0.5 }),
    );
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.UNATTENDED);
    expect(runConfigPlacementOf(ctx)?.lane.turnName).toBe("the share's run_config");
  });

  it("an edition lane that answers no approval mode is stamped INTERACTIVE, never UNSPECIFIED", async () => {
    const lanes: RunLanes = {
      laneOf: () =>
        Promise.resolve({ settingsName: "the share's run_config", approvalMode: ApprovalMode.UNSPECIFIED }),
    };
    const ctx = await resolve(execution({ spec: { message: "hi" } }), { runLanes: lanes });
    expect(ctx.newState.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
  });

  it("an edition lane with no saved settings clears the request's", async () => {
    const lanes: RunLanes = {
      laneOf: () =>
        Promise.resolve({ settingsName: "the channel's run_config", approvalMode: ApprovalMode.UNATTENDED }),
    };
    const ctx = await resolve(
      execution({ spec: { message: "hi", runConfig: { modelName: "visitor-choice" } } }),
      { runLanes: lanes },
    );
    expect(ctx.newState.spec?.runConfig).toBeUndefined();
    expect(ctx.newState.status?.runConfig).toEqual(rc({}));
  });

  it("refuses an unattended Cursor turn that would run with no model, naming where to set one", async () => {
    const err = await resolve(
      execution({
        metadata: { labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_1" } },
        spec: {
          message: "hi",
          target: { case: "sessionSpec", value: { harness: Harness.CURSOR } },
        },
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((err as ConnectError).rawMessage).toContain("the schedule's run_config");
    expect((err as ConnectError).rawMessage).toContain("stigmer/stigmer#362");
  });

  it("refuses a schedule's saved fast tier with no model of its own, naming the schedule's settings", async () => {
    const err = await resolve(
      execution({
        metadata: { labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_1" } },
        spec: { message: "hi", runConfig: { serviceTier: ServiceTier.FAST } },
        status: { agentId: AGENT, agentVersionHash: PINNED },
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    expect((err as ConnectError).rawMessage).toContain("the schedule's run_config");
  });

  it("lets a live message set thinking alone, on the agent's model", async () => {
    const ctx = await resolve(
      execution({
        spec: { message: "hi", runConfig: { thinkingMode: ThinkingMode.DISABLED } },
        status: { agentId: AGENT, agentVersionHash: PINNED },
      }),
    );
    expect(ctx.newState.status?.runConfig?.modelName).toBe("claude-sonnet-5");
    expect(ctx.newState.status?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
  });

  it("an attended Cursor turn with no model runs Auto, as a person chose", async () => {
    const ctx = await resolve(
      execution({
        spec: {
          message: "hi",
          target: { case: "sessionSpec", value: { harness: Harness.CURSOR } },
        },
      }),
    );
    expect(ctx.newState.status?.runConfig?.modelName).toBe("");
  });

  it("reResolveRunConfig resolves again over the version the created session pinned", async () => {
    const exec = execution({
      spec: { message: "hi" },
      status: { agentId: AGENT, agentVersionHash: PINNED },
    });
    const ctx = await resolve(exec);
    const unchanged = await reResolveRunConfig(
      ctx,
      store,
      exec,
      create(SessionSchema, {
        spec: { harness: Harness.NATIVE },
        status: { agentId: AGENT, agentVersionHash: PINNED },
      }),
    );
    expect(unchanged).toBeUndefined();

    const moved = await reResolveRunConfig(
      ctx,
      store,
      exec,
      create(SessionSchema, {
        spec: { harness: Harness.NATIVE },
        status: { agentId: AGENT, agentVersionHash: HEAD },
      }),
    );
    expect(moved?.agentVersionHash).toBe(HEAD);
    expect(exec.status?.runConfig).toEqual(rc({ modelName: "claude-haiku-4.5" }));
    expect(runConfigPlacementOf(ctx)).toBe(moved);
  });

  it("names the profile, and no layer, in a refusal", async () => {
    const ctx = await resolve(
      execution({ spec: { message: "hi" } }),
      {
        runLanes: {
          laneOf: () =>
            Promise.resolve({
              settingsName: "the share's run_config",
              profile: rc({ modelName: "claude-sonnet-4.6", serviceTier: ServiceTier.FAST }),
              approvalMode: ApprovalMode.UNATTENDED,
            }),
        },
      },
    );
    const placement = runConfigPlacementOf(ctx)!;
    expect(serviceTierRefusal(REGISTRY, placement)).toContain("from the lane's operator profile");
    const bare = await resolve(execution({ spec: { message: "hi", runConfig: { serviceTier: ServiceTier.FAST } } }));
    expect(serviceTierRefusal(REGISTRY, runConfigPlacementOf(bare)!)).toContain("from the request's run_config");
    expect(runConfigLayerName(runConfigPlacementOf(bare)!, undefined)).toBe("no layer");
  });

  describe("CreateSessionIfNeeded judges a re-resolution by the same checks", () => {
    const FAST_UNPRICED = "e".repeat(64);

    beforeEach(async () => {
      // A version saved between the two resolutions whose defaults ask for
      // fast on a model with no fast price.
      await store.saveAudit(
        ApiResourceKind.agent,
        AGENT,
        AgentSchema,
        create(AgentSchema, {
          metadata: { id: AGENT, org: "acme", slug: "reviewer" },
          spec: {
            harness: Harness.NATIVE,
            runConfig: { modelName: "claude-sonnet-4.6", serviceTier: ServiceTier.FAST },
          },
          status: { versionHash: FAST_UNPRICED },
        }),
        FAST_UNPRICED,
        "",
      );
    });

    async function createSessionPinning(
      ctx: RequestContext<typeof AgentExecutionSchema>,
      session: { harness: Harness; versionHash: string },
    ): Promise<unknown> {
      return Promise.resolve(newCreateSessionIfNeededStep({
        logger: createLogger({ level: "error", pretty: false, write: () => {} }),
        sessionCreator: () => ({
          createAsCaller: () =>
            Promise.resolve(
              create(SessionSchema, {
                metadata: { id: "ses_new" },
                spec: { harness: session.harness },
                status: { agentId: AGENT, agentVersionHash: session.versionHash },
              }),
            ),
        }),
        store,
        modelRegistry: REGISTRY,
      }).execute(ctx))
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    }

    it("refuses a tier the re-resolved version cannot price", async () => {
      const ctx = await resolve(
        execution({ spec: { message: "hi" }, status: { agentId: AGENT, agentVersionHash: PINNED } }),
      );
      const err = await createSessionPinning(ctx, { harness: Harness.NATIVE, versionHash: FAST_UNPRICED });
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
      expect((err as ConnectError).rawMessage).toContain("from the agent's run defaults");
    });

    it("refuses an unattended turn the created session leaves on Cursor with no model", async () => {
      const ctx = await resolve(
        execution({
          metadata: { labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_1" } },
          spec: { message: "hi" },
          status: { agentId: AGENT, agentVersionHash: PINNED },
        }),
      );
      const err = await createSessionPinning(ctx, { harness: Harness.CURSOR, versionHash: PINNED });
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    });
  });
});
