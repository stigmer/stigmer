/**
 * Pins the agent eval steps' arms the composed lanes cannot reach (no
 * engine runs behind them), over a temp store:
 *
 *   - the create's question is can_edit on the agent, and a
 *     server-composed create asks none; a store fault reading the agent is
 *     INTERNAL;
 *   - the defaults refuse a request with no organization or no spec, and
 *     real servers asked for both beside the mocks and instead of them;
 *     an allow_tools entry naming an attached plugin's own MCP server is
 *     kept as written, the version is stamped as its hash and the id is
 *     minted;
 *   - a target naming a model the catalog does not run on its engine is
 *     refused, naming the target;
 *   - the plan refuses no spec and a case_glob that is not a glob; a
 *     plugin with no version to read is stamped "no eval cases at this
 *     version" without a read; a suite source's own refusal passes
 *     through while any other fault is INTERNAL; the limits count every
 *     plugin's cases together; filters that keep no case are refused;
 *   - after the eval is stored, an agent deleted meanwhile takes the eval
 *     with it (row and access) and the create answers NOT_FOUND for the
 *     agent; a fault reading the agent or removing the row is INTERNAL;
 *   - a failed start marks a pending eval failed with a fixed sentence,
 *     never overwrites a row the workflow already moved, answers NOT_FOUND
 *     for a row gone and INTERNAL for a store fault;
 *   - an eval that outlived its workflow is answered and stored failed by
 *     get, and a row its settle cannot find is answered as read;
 *   - cancel, every arm: a finished eval answered unchanged, an outlived
 *     one failed without asking, a cancel the workflow takes answered
 *     unchanged, no workflow failing a running eval and cancelling a
 *     pending one, no engine UNAVAILABLE, any other fault INTERNAL;
 *   - listByAgent keeps only the evals the caller may view (a
 *     server-composed caller sees them all), fails closed when the
 *     authorizer cannot answer, answers a store fault INTERNAL, and
 *     answers each eval without its tries, its summaries kept;
 *   - a chain built wrong (the agent, the version, the cancel's target or
 *     the delete's row never stashed) fails loudly as INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PluginFiles } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import {
  AgentEvalIdSchema,
  ListAgentEvalsByAgentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import type { AgentEvalList } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { AgentEvalPluginSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalArmSchema,
  PluginEvalCaseSchema,
  PluginEvalCaseTargetSchema,
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
  PluginEvalTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../../pipeline/steps/load-target.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  PLUGIN_EVAL_NO_ENGINE_MESSAGE,
  PLUGIN_EVAL_NOT_STARTED_ERROR,
  PLUGIN_EVAL_REAL_SERVERS_CONFLICT_MESSAGE,
  PLUGIN_EVAL_WORKFLOW_ENDED_ERROR,
  pluginEvalCaseGlobMessage,
  pluginEvalTooLargeMessage,
} from "../../plugin-eval/constants.js";
import type { EvalSuiteSource } from "../../plugin-eval/suite.js";
import { PluginEvalEngineUnavailableError } from "../../plugin-eval/workflows.js";
import type { PluginEvalWorkflows } from "../../plugin-eval/workflows.js";
import { AGENT_EVAL_CREATE_DENIED_MESSAGE, PLUGIN_NO_CASES_REASON } from "../constants.js";
import {
  AGENT_EVAL_RESULT_KEY,
  EVALUATED_AGENT_KEY,
  EVALUATED_VERSION_KEY,
  newCancelAgentEvalStep,
  newEnsureEvaluatedAgentStillExistsStep,
  newListAgentEvalsByAgentStep,
  newLoadEvaluatedAgentStep,
  newPlanAgentEvalStep,
  newRefuseActiveAgentEvalDeleteStep,
  newResolveAgentEvalDefaultsStep,
  newSettleEndedAgentEvalStep,
  newStartAgentEvalWorkflowStep,
  newValidateAgentEvalTargetsStep,
  resolveAgentEvalCreateTargets,
  settleEndedAgentEval,
} from "../steps.js";
import type { EvaluatedVersion } from "../steps.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

const ORG = "org_1";
const AGENT_ID = "agt_1";
const AGENT_HASH = "a".repeat(64);
const DIGEST = "d".repeat(64);
const OTHER_DIGEST = "e".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

const catalog = newModelCatalogProviderFromDocument(
  JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
);

let temp: TempStore;

beforeEach(() => {
  // Rows seeded straight into the store hold their names, as their chains would.
  const opened = tempStore();
  temp = { ...opened, store: namingSaves(opened.store) };
});

afterEach(async () => {
  await temp.cleanup();
});

function evalRow(id: string, phase: PluginEvalPhase): AgentEval {
  return create(AgentEvalSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { agentId: AGENT_ID, maxCostUsd: 5 },
    status: { phase },
  });
}

async function saved(row: AgentEval): Promise<AgentEval> {
  await temp.store.saveResource(ApiResourceKind.agent_eval, row.metadata!.id, AgentEvalSchema, row);
  return row;
}

async function stored(id: string): Promise<AgentEval> {
  return temp.store.getResource(ApiResourceKind.agent_eval, id, AgentEvalSchema);
}

const AGENT: Agent = create(AgentSchema, {
  metadata: { id: AGENT_ID, org: ORG, slug: "support-desk", name: "support-desk" },
  spec: {
    instructions: "You answer support tickets.",
    plugins: [{ kind: ApiResourceKind.plugin, slug: "thermos" }],
  },
  status: { versionHash: AGENT_HASH },
});

const THERMOS: Plugin = create(PluginSchema, {
  metadata: { id: "plg_1", org: ORG, slug: "thermos", name: "thermos" },
  spec: { name: "thermos" },
  status: { digest: DIGEST, mcpServers: [{ name: "github" }] },
});

async function seedAgent(): Promise<void> {
  await temp.store.saveResource(ApiResourceKind.agent, AGENT_ID, AgentSchema, AGENT);
}

function failing<M extends keyof Store>(store: Store, method: M): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk unavailable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function workflows(answers: Partial<PluginEvalWorkflows> = {}): PluginEvalWorkflows & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: async (id) => {
      calls.push(`start ${id}`);
      await answers.start?.(id);
    },
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
      return answers.cancel === undefined ? "requested" : answers.cancel(id);
    },
  };
}

/** A lifecycle that records each deleted resource's cleanup. */
function lifecycle(): ResourceAuthorizationLifecycle & { cleaned: string[] } {
  const cleaned: string[] = [];
  return {
    cleaned,
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: (event: ResourceDeletedEvent) => {
      cleaned.push(`${ApiResourceKind[event.kind]} ${event.resourceId} ${event.orgId}`);
      return Promise.resolve();
    },
    onVisibilityChanged: () => Promise.resolve(),
  };
}

function warnings(): { logger: Logger; warned: Array<{ message: string; fields: unknown }> } {
  const warned: Array<{ message: string; fields: unknown }> = [];
  return { warned, logger: { ...silentLogger, warn: (message, fields) => warned.push({ message, fields }) } };
}

function createCtx(row: AgentEval, caller = testCallerIdentity()) {
  return new RequestContext(AgentEvalSchema, row, caller, ApiResourceKind.agent_eval);
}

function bareIdCtx(id = "aev_1") {
  return new RequestContext(
    AgentEvalIdSchema,
    create(AgentEvalIdSchema, { value: id }),
    testCallerIdentity(),
    ApiResourceKind.agent_eval,
  );
}

function idCtx(target: AgentEval) {
  const ctx = bareIdCtx(target.metadata!.id);
  ctx.set(TARGET_RESOURCE_KEY, target);
  return ctx;
}

async function failure(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a failure");
}

describe("the create's question and the agent's read", () => {
  it("asks can_edit on the agent, and nothing for a server-composed create", () => {
    const row = evalRow("", PluginEvalPhase.unspecified);
    expect(resolveAgentEvalCreateTargets(createCtx(row))).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: AGENT_ID,
        deniedMessage: AGENT_EVAL_CREATE_DENIED_MESSAGE,
      },
    ]);
    expect(resolveAgentEvalCreateTargets(createCtx(row, testCallerIdentity({ origin: "in-process" })))).toEqual([]);
  });

  it("stashes the agent it reads, and is INTERNAL when the store cannot read it", async () => {
    await seedAgent();
    const ctx = createCtx(evalRow("", PluginEvalPhase.unspecified));
    await newLoadEvaluatedAgentStep(temp.store).execute(ctx);
    expect((ctx.get(EVALUATED_AGENT_KEY) as Agent).metadata?.id).toBe(AGENT_ID);

    const fault = await failure(() =>
      newLoadEvaluatedAgentStep(failing(temp.store, "getResource")).execute(
        createCtx(evalRow("", PluginEvalPhase.unspecified)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to load the agent to evaluate");
  });
});

describe("ResolveAgentEvalDefaults", () => {
  function evaluated(row: AgentEval) {
    const ctx = createCtx(row);
    ctx.set(EVALUATED_AGENT_KEY, AGENT);
    return ctx;
  }

  it("refuses a request that names no organization, or carries no spec", async () => {
    const noOrg = evalRow("", PluginEvalPhase.unspecified);
    noOrg.metadata!.org = "";
    const orgRefusal = await failure(() => newResolveAgentEvalDefaultsStep(temp.store).execute(evaluated(noOrg)));
    expect(orgRefusal.code).toBe(Code.InvalidArgument);
    expect(orgRefusal.rawMessage).toBe("metadata.org is required for an agent eval");

    const noMetadata = evalRow("", PluginEvalPhase.unspecified);
    noMetadata.metadata = undefined;
    expect((await failure(() => newResolveAgentEvalDefaultsStep(temp.store).execute(evaluated(noMetadata)))).rawMessage).toBe(
      "metadata.org is required for an agent eval",
    );

    const noSpec = evalRow("", PluginEvalPhase.unspecified);
    noSpec.spec = undefined;
    const specRefusal = await failure(() => newResolveAgentEvalDefaultsStep(temp.store).execute(evaluated(noSpec)));
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for an agent eval");
  });

  it("refuses real servers asked for both beside the mocks and instead of them", async () => {
    const row = evalRow("", PluginEvalPhase.unspecified);
    row.spec!.allowRealServers = true;
    row.spec!.realMcpServers = true;
    const refused = await failure(() => newResolveAgentEvalDefaultsStep(temp.store).execute(evaluated(row)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(PLUGIN_EVAL_REAL_SERVERS_CONFLICT_MESSAGE);
  });

  it("keeps an entry naming an attached plugin's own server, stamps the version's hash and mints the id", async () => {
    await seedAgent();
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, THERMOS);
    const row = evalRow("", PluginEvalPhase.unspecified);
    const tools = ["Read", "mcp__plugin_thermos_github__search_issues"];
    row.spec!.allowTools = [...tools];
    const ctx = evaluated(row);
    await newResolveAgentEvalDefaultsStep(temp.store).execute(ctx);
    expect(ctx.newState.spec?.allowTools).toEqual(tools);
    expect(ctx.newState.spec?.agentVersion).toBe(AGENT_HASH);
    expect(ctx.newState.metadata?.id).toMatch(/^aev_/);
    expect(ctx.newState.metadata?.name).toBe(ctx.newState.metadata?.id);
    const version = ctx.get(EVALUATED_VERSION_KEY) as EvaluatedVersion;
    expect(version.plugins.map((plugin) => plugin.metadata?.id)).toEqual(["plg_1"]);
  });
});

describe("ValidateAgentEvalTargets", () => {
  it("passes a target the catalog runs, and refuses one naming a model it does not, naming the target", async () => {
    const row = evalRow("", PluginEvalPhase.unspecified);
    row.spec!.targets = [
      create(PluginEvalTargetSchema, { harness: Harness.NATIVE, modelName: "native-model" }),
      create(PluginEvalTargetSchema, { harness: Harness.NATIVE, modelName: "no-such-model" }),
    ];
    const refused = await failure(() => newValidateAgentEvalTargetsStep(catalog).execute(createCtx(row)));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toContain("spec.targets[1].model_name");
    expect(refused.rawMessage).toContain("no-such-model");

    row.spec!.targets = [row.spec!.targets[0]!];
    await newValidateAgentEvalTargetsStep(catalog).execute(createCtx(row));
  });
});

describe("PlanAgentEval", () => {
  /** `count` cases, each with one regex grader. */
  function suiteOf(count: number, prefix = "case"): PluginFiles {
    return inMemoryPluginFiles(
      new Map(
        Array.from({ length: count }, (_, index) => index).flatMap((index): Array<[string, string]> => [
          [`evals/${prefix}-${index}/prompt.md`, "Say yes.\n"],
          [`evals/${prefix}-${index}/graders/says-yes.md`, "---\ntype: regex\npattern: yes\n---\n"],
        ]),
      ),
    );
  }

  /** A source answering each digest's files, counting the reads by digest. */
  function source(byDigest: Readonly<Record<string, PluginFiles>>): EvalSuiteSource & { reads: string[] } {
    const reads: string[] = [];
    return {
      reads,
      readArchive: (_pluginId, digest) => {
        reads.push(digest);
        const files = byDigest[digest];
        return files === undefined ? Promise.reject(new Error(`no archive ${digest}`)) : Promise.resolve(files);
      },
    };
  }

  function plugin(id: string, slug: string, digest: string): Plugin {
    return create(PluginSchema, { metadata: { id, slug, name: slug, org: ORG }, status: { digest } });
  }

  function planCtx(row: AgentEval, plugins: ReadonlyArray<Plugin>) {
    const ctx = createCtx(row);
    ctx.set(EVALUATED_VERSION_KEY, { spec: AGENT.spec, plugins } satisfies EvaluatedVersion);
    return ctx;
  }

  function planRow(spec: Partial<{ caseGlob: string; runs: number }> = {}): AgentEval {
    const row = evalRow("aev_1", PluginEvalPhase.unspecified);
    row.spec!.agentVersion = AGENT_HASH;
    row.spec!.runs = spec.runs ?? 1;
    row.spec!.caseGlob = spec.caseGlob ?? "";
    return row;
  }

  it("refuses an eval with no spec, and a case_glob that is not a glob, before reading any suite", async () => {
    const files = source({ [DIGEST]: suiteOf(1) });
    const noSpec = planRow();
    noSpec.spec = undefined;
    const specRefusal = await failure(() =>
      newPlanAgentEvalStep(files, catalog).execute(planCtx(noSpec, [plugin("plg_1", "thermos", DIGEST)])),
    );
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for an agent eval");

    const badGlob = await failure(() =>
      newPlanAgentEvalStep(files, catalog).execute(
        planCtx(planRow({ caseGlob: "review-[z-a]" }), [plugin("plg_1", "thermos", DIGEST)]),
      ),
    );
    expect(badGlob.code).toBe(Code.InvalidArgument);
    expect(badGlob.rawMessage).toBe(pluginEvalCaseGlobMessage("review-[z-a]", "range 'z-a' is reversed"));
    expect(files.reads).toEqual([]);
  });

  it("stamps a plugin with no version to read as having no cases, without reading it", async () => {
    const files = source({ [DIGEST]: suiteOf(2) });
    const ctx = planCtx(planRow(), [plugin("plg_0", "unbuilt", ""), plugin("plg_1", "thermos", DIGEST)]);
    await newPlanAgentEvalStep(files, catalog).execute(ctx);
    expect(files.reads).toEqual([DIGEST]);
    const status = ctx.newState.status;
    expect(status?.plugins.map((entry) => [entry.pluginSlug, entry.pluginDigest, entry.notRunReason])).toEqual([
      ["unbuilt", "", PLUGIN_NO_CASES_REASON],
      ["thermos", DIGEST, ""],
    ]);
    expect(status?.phase).toBe(PluginEvalPhase.pending);
    expect(status?.agentVersionHash).toBe(AGENT_HASH);
    expect(status?.triesTotal).toBe(2);
  });

  it("passes a suite source's own refusal through, and makes any other fault INTERNAL", async () => {
    const thermos = [plugin("plg_1", "thermos", DIGEST)];
    const notFound = await failure(() =>
      newPlanAgentEvalStep(
        { readArchive: () => Promise.reject(new ConnectError("plugin version not found", Code.NotFound)) },
        catalog,
      ).execute(planCtx(planRow(), thermos)),
    );
    expect(notFound.code).toBe(Code.NotFound);
    expect(notFound.rawMessage).toBe("plugin version not found");

    const broken = await failure(() =>
      newPlanAgentEvalStep({ readArchive: () => Promise.reject(new Error("disk")) }, catalog).execute(
        planCtx(planRow(), thermos),
      ),
    );
    expect(broken.code).toBe(Code.Internal);
    expect(broken.rawMessage).toBe("failed to read the plugins' evals");
  });

  it("counts every plugin's cases together against the limits, though each alone fits", async () => {
    const files = source({ [DIGEST]: suiteOf(120, "a"), [OTHER_DIGEST]: suiteOf(120, "b") });
    const tooLarge = await failure(() =>
      newPlanAgentEvalStep(files, catalog).execute(
        planCtx(planRow(), [plugin("plg_1", "thermos", DIGEST), plugin("plg_2", "refunds", OTHER_DIGEST)]),
      ),
    );
    expect(tooLarge.code).toBe(Code.FailedPrecondition);
    expect(tooLarge.rawMessage).toBe(pluginEvalTooLargeMessage(240, 240));
  });

  it("refuses filters that keep no case of any plugin", async () => {
    const files = source({ [DIGEST]: suiteOf(2) });
    const refused = await failure(() =>
      newPlanAgentEvalStep(files, catalog).execute(
        planCtx(planRow({ caseGlob: "nothing-*" }), [plugin("plg_1", "thermos", DIGEST)]),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe("no eval case matches case_glob and case_tags");
  });
});

describe("EnsureEvaluatedAgentStillExists", () => {
  function storedCtx(row: AgentEval) {
    return createCtx(row);
  }

  it("leaves everything as it is while the agent is there", async () => {
    await seedAgent();
    const row = await saved(evalRow("aev_1", PluginEvalPhase.pending));
    const access = lifecycle();
    await newEnsureEvaluatedAgentStillExistsStep(temp.store, access, silentLogger).execute(storedCtx(row));
    expect((await stored("aev_1")).metadata?.id).toBe("aev_1");
    expect(access.cleaned).toEqual([]);
  });

  it("removes the eval and its access when the agent was deleted meanwhile, and answers NOT_FOUND for the agent", async () => {
    const row = await saved(evalRow("aev_1", PluginEvalPhase.pending));
    const access = lifecycle();
    const { logger, warned } = warnings();
    const refused = await failure(() =>
      newEnsureEvaluatedAgentStillExistsStep(temp.store, access, logger).execute(storedCtx(row)),
    );
    expect(refused.code).toBe(Code.NotFound);
    expect(refused.rawMessage).toContain(AGENT_ID);
    await expect(stored("aev_1")).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(access.cleaned).toEqual([`agent_eval aev_1 ${ORG}`]);
    expect(warned).toEqual([
      {
        message: "an agent eval's agent was deleted while it was created; removing the eval",
        fields: { evalId: "aev_1", agentId: AGENT_ID },
      },
    ]);
  });

  it("is INTERNAL when the agent cannot be read, or the eval of a deleted agent cannot be removed", async () => {
    const row = await saved(evalRow("aev_1", PluginEvalPhase.pending));
    const unread = await failure(() =>
      newEnsureEvaluatedAgentStillExistsStep(failing(temp.store, "getResource"), undefined, silentLogger).execute(
        storedCtx(row),
      ),
    );
    expect(unread.code).toBe(Code.Internal);
    expect(unread.rawMessage).toBe("failed to read the agent to evaluate again");

    const access = lifecycle();
    const unremoved = await failure(() =>
      newEnsureEvaluatedAgentStillExistsStep(failing(temp.store, "deleteResource"), access, silentLogger).execute(
        storedCtx(row),
      ),
    );
    expect(unremoved.code).toBe(Code.Internal);
    expect(unremoved.rawMessage).toBe("failed to remove the agent eval of a deleted agent");
    expect(access.cleaned).toEqual([]);
    expect((await stored("aev_1")).metadata?.id).toBe("aev_1");
  });
});

describe("StartAgentEvalWorkflow", () => {
  it("leaves the pending row as it is when the workflow starts", async () => {
    const row = await saved(evalRow("aev_1", PluginEvalPhase.pending));
    const port = workflows();
    const ctx = createCtx(row);
    await newStartAgentEvalWorkflowStep(temp.store, port, silentLogger).execute(ctx);
    expect(port.calls).toEqual(["start aev_1"]);
    expect(ctx.newState.status?.phase).toBe(PluginEvalPhase.pending);
    expect((await stored("aev_1")).status?.phase).toBe(PluginEvalPhase.pending);
  });

  it("marks a pending eval failed with a fixed sentence when the start fails, and logs the engine's error", async () => {
    const row = await saved(evalRow("aev_1", PluginEvalPhase.pending));
    const ctx = createCtx(row);
    const { logger, warned } = warnings();
    await newStartAgentEvalWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("dial tcp 10.0.0.7:7233: connection refused")) }),
      logger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(PluginEvalPhase.failed);
    expect(ctx.newState.status?.error).toBe(PLUGIN_EVAL_NOT_STARTED_ERROR);
    expect(ctx.newState.status?.finishedAt).toBeDefined();
    expect((await stored("aev_1")).status?.phase).toBe(PluginEvalPhase.failed);
    expect(warned).toEqual([
      {
        message: "an agent eval's workflow could not start; marking it failed",
        fields: { evalId: "aev_1", cause: "dial tcp 10.0.0.7:7233: connection refused" },
      },
    ]);
  });

  it("never overwrites a row the workflow already moved to running", async () => {
    const pending = evalRow("aev_1", PluginEvalPhase.pending);
    await saved(evalRow("aev_1", PluginEvalPhase.running));
    const ctx = createCtx(pending);
    await newStartAgentEvalWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("deadline exceeded")) }),
      silentLogger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(PluginEvalPhase.running);
    expect(ctx.newState.status?.error).toBe("");
    expect((await stored("aev_1")).status?.phase).toBe(PluginEvalPhase.running);
  });

  it("answers NOT_FOUND for a row gone, and INTERNAL when the store cannot save the failure", async () => {
    const failingStart = workflows({ start: () => Promise.reject(new Error("no engine")) });
    const gone = await failure(() =>
      newStartAgentEvalWorkflowStep(temp.store, failingStart, silentLogger).execute(
        createCtx(evalRow("aev_gone", PluginEvalPhase.pending)),
      ),
    );
    expect(gone.code).toBe(Code.NotFound);
    expect(gone.rawMessage).toContain("aev_gone");

    const fault = await failure(() =>
      newStartAgentEvalWorkflowStep(failing(temp.store, "updateResource"), failingStart, silentLogger).execute(
        createCtx(evalRow("aev_1", PluginEvalPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to save the agent eval");
  });
});

describe("an agent eval whose workflow ended without finishing", () => {
  function outlived(id: string, phase: PluginEvalPhase): AgentEval {
    const row = evalRow(id, phase);
    row.status!.startedAt = timestampFromMs(Date.now() - 31 * DAY_MS);
    return row;
  }

  it("is answered failed by get and stored so, while a live one is answered as it is", async () => {
    const stale = await saved(outlived("aev_stale", PluginEvalPhase.running));
    const ctx = idCtx(stale);
    await newSettleEndedAgentEvalStep(temp.store).execute(ctx);
    const answered = ctx.get(TARGET_RESOURCE_KEY) as AgentEval;
    expect(answered.status?.phase).toBe(PluginEvalPhase.failed);
    expect(answered.status?.error).toBe(PLUGIN_EVAL_WORKFLOW_ENDED_ERROR);
    expect(answered.status?.finishedAt).toBeDefined();
    expect((await stored("aev_stale")).status?.phase).toBe(PluginEvalPhase.failed);

    const live = await saved(evalRow("aev_live", PluginEvalPhase.running));
    const liveCtx = idCtx(live);
    await newSettleEndedAgentEvalStep(temp.store).execute(liveCtx);
    expect(liveCtx.get(TARGET_RESOURCE_KEY)).toBe(live);
  });

  it("is answered as read when its row is gone before the settle", async () => {
    const gone = outlived("aev_gone", PluginEvalPhase.pending);
    expect(await settleEndedAgentEval(temp.store, gone)).toBe(gone);
    expect(gone.status?.phase).toBe(PluginEvalPhase.pending);
  });
});

describe("CancelAgentEval", () => {
  function result(ctx: ReturnType<typeof idCtx>): AgentEval {
    return ctx.get(AGENT_EVAL_RESULT_KEY) as AgentEval;
  }

  it("answers a finished eval unchanged without asking the workflow", async () => {
    const finished = await saved(evalRow("aev_1", PluginEvalPhase.completed));
    const port = workflows();
    const ctx = idCtx(finished);
    await newCancelAgentEvalStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(result(ctx)).toBe(finished);
  });

  it("fails an eval that outlived its workflow without asking it", async () => {
    const stale = evalRow("aev_1", PluginEvalPhase.running);
    stale.status!.startedAt = timestampFromMs(Date.now() - 31 * DAY_MS);
    await saved(stale);
    const port = workflows();
    const ctx = idCtx(stale);
    await newCancelAgentEvalStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(result(ctx).status?.phase).toBe(PluginEvalPhase.failed);
    expect(result(ctx).status?.error).toBe(PLUGIN_EVAL_WORKFLOW_ENDED_ERROR);
  });

  it("answers the row unchanged when the workflow takes the cancel", async () => {
    const running = await saved(evalRow("aev_1", PluginEvalPhase.running));
    const port = workflows();
    const ctx = idCtx(running);
    await newCancelAgentEvalStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual(["cancel aev_1"]);
    expect(result(ctx)).toBe(running);
    expect((await stored("aev_1")).status?.phase).toBe(PluginEvalPhase.running);
  });

  it("with no workflow, fails a running eval and cancels a pending one", async () => {
    const none = workflows({ cancel: () => Promise.resolve("not-found") });
    const running = await saved(evalRow("aev_running", PluginEvalPhase.running));
    const runningCtx = idCtx(running);
    await newCancelAgentEvalStep(temp.store, none).execute(runningCtx);
    expect(result(runningCtx).status?.phase).toBe(PluginEvalPhase.failed);
    expect(result(runningCtx).status?.error).toBe(PLUGIN_EVAL_WORKFLOW_ENDED_ERROR);

    const pending = await saved(evalRow("aev_pending", PluginEvalPhase.pending));
    const pendingCtx = idCtx(pending);
    await newCancelAgentEvalStep(temp.store, none).execute(pendingCtx);
    expect(result(pendingCtx).status?.phase).toBe(PluginEvalPhase.partial);
    expect(result(pendingCtx).status?.partialReason).toBe(PluginEvalPartialReason.cancelled);
    expect(result(pendingCtx).status?.finishedAt).toBeDefined();
    expect((await stored("aev_pending")).status?.phase).toBe(PluginEvalPhase.partial);
  });

  it("is UNAVAILABLE with no engine connection and INTERNAL on any other fault", async () => {
    const running = await saved(evalRow("aev_1", PluginEvalPhase.running));
    const noEngine = await failure(() =>
      newCancelAgentEvalStep(
        temp.store,
        workflows({ cancel: () => Promise.reject(new PluginEvalEngineUnavailableError()) }),
      ).execute(idCtx(running)),
    );
    expect(noEngine.code).toBe(Code.Unavailable);
    expect(noEngine.rawMessage).toBe(PLUGIN_EVAL_NO_ENGINE_MESSAGE);

    const fault = await failure(() =>
      newCancelAgentEvalStep(temp.store, workflows({ cancel: () => Promise.reject(new Error("transport")) })).execute(
        idCtx(running),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to cancel the agent eval");
    expect((await stored("aev_1")).status?.phase).toBe(PluginEvalPhase.running);
  });
});

describe("ListAgentEvalsByAgent", () => {
  function listCtx(caller = testCallerIdentity()) {
    return new RequestContext(
      ListAgentEvalsByAgentRequestSchema,
      create(ListAgentEvalsByAgentRequestSchema, { agentId: AGENT_ID }),
      caller,
      ApiResourceKind.agent,
    );
  }

  function listed(ctx: ReturnType<typeof listCtx>): AgentEvalList {
    return ctx.get(AGENT_EVAL_RESULT_KEY) as AgentEvalList;
  }

  it("keeps only the evals the caller may view, and every one for a server-composed caller", async () => {
    await saved(evalRow("aev_a", PluginEvalPhase.completed));
    await saved(evalRow("aev_b", PluginEvalPhase.completed));
    const asked: string[] = [];
    const onlyA: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${IamPermission[check.permission]} ${ApiResourceKind[check.resourceKind]} ${check.resourceId}`);
        return Promise.resolve(check.resourceId === "aev_a" ? { kind: "allow" } : { kind: "deny", reason: "" });
      },
    };
    const ctx = listCtx();
    await newListAgentEvalsByAgentStep(temp.store, onlyA, silentLogger).execute(ctx);
    expect(listed(ctx).entries.map((row) => row.metadata?.id)).toEqual(["aev_a"]);
    expect(listed(ctx).entries).toHaveLength(1);
    expect(asked.sort()).toEqual(["can_view agent_eval aev_a", "can_view agent_eval aev_b"]);

    asked.length = 0;
    const serverCtx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListAgentEvalsByAgentStep(temp.store, onlyA, silentLogger).execute(serverCtx);
    expect(listed(serverCtx).entries).toHaveLength(2);
    expect(asked).toEqual([]);
  });

  it("walks only the agent's evals carrying every label named, a page at a time", async () => {
    const labels = { suite: "nightly-agent-evals", tier: "gold" };
    const labelled = (id: string, rowLabels: Record<string, string>) => {
      const row = evalRow(id, PluginEvalPhase.completed);
      row.metadata!.labels = rowLabels;
      return saved(row);
    };
    await labelled("aev_lbl_0", {});
    await labelled("aev_lbl_1", labels);
    await labelled("aev_lbl_2", { suite: "nightly-agent-evals" });
    await labelled("aev_lbl_3", { ...labels, extra: "x" });
    const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

    const walked: string[] = [];
    let pageToken = "";
    do {
      const ctx = new RequestContext(
        ListAgentEvalsByAgentRequestSchema,
        create(ListAgentEvalsByAgentRequestSchema, { agentId: AGENT_ID, labels, pageSize: 1, pageToken }),
        testCallerIdentity(),
        ApiResourceKind.agent,
      );
      await newListAgentEvalsByAgentStep(temp.store, allow, silentLogger).execute(ctx);
      expect(listed(ctx).entries.length).toBeLessThanOrEqual(1);
      walked.push(...listed(ctx).entries.map((row) => row.metadata!.id));
      pageToken = listed(ctx).nextPageToken;
    } while (pageToken !== "");
    expect(new Set(walked)).toEqual(new Set(["aev_lbl_1", "aev_lbl_3"]));
    expect(walked).toHaveLength(2);
  });

  it("fails closed when the authorizer cannot answer, and answers a store fault INTERNAL", async () => {
    await saved(evalRow("aev_a", PluginEvalPhase.completed));
    const down: Authorizer = {
      authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }),
    };
    const unanswered = await failure(() => newListAgentEvalsByAgentStep(temp.store, down, silentLogger).execute(listCtx()));
    expect(unanswered.code).toBe(Code.Internal);
    expect(unanswered.rawMessage).toBe("failed to authorize the agent's evals");

    const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };
    const fault = await failure(() =>
      newListAgentEvalsByAgentStep(failing(temp.store, "queryResources"), allow, silentLogger).execute(listCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the agent's evals");
  });

  it("answers each eval without its tries, keeping every summary, and leaves the stored row whole", async () => {
    const row = evalRow("aev_tries", PluginEvalPhase.completed);
    row.status!.plugins = [
      create(AgentEvalPluginSchema, {
        pluginId: "plg_1",
        pluginSlug: "thermos",
        pluginDigest: DIGEST,
        cases: [
          create(PluginEvalCaseSchema, {
            caseName: "a",
            notes: ["a note"],
            targets: [
              create(PluginEvalCaseTargetSchema, {
                withPlugin: create(PluginEvalArmSchema, {
                  score: 1,
                  gradedTries: 2,
                  tries: [
                    create(PluginEvalTrySchema, { index: 1, state: PluginEvalTryState.graded, score: 1 }),
                    create(PluginEvalTrySchema, { index: 2, state: PluginEvalTryState.graded, score: 1 }),
                  ],
                }),
              }),
              create(PluginEvalCaseTargetSchema, { notRunReason: "not run: model 'x' is not in Stigmer's catalog" }),
            ],
          }),
        ],
      }),
    ];
    await saved(row);
    const ctx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListAgentEvalsByAgentStep(temp.store, { authorize: () => Promise.resolve({ kind: "allow" }) }, silentLogger).execute(
      ctx,
    );
    const evalCase = listed(ctx).entries[0]?.status?.plugins[0]?.cases[0];
    expect(evalCase?.targets[0]?.withPlugin?.tries).toEqual([]);
    expect(evalCase?.targets[0]?.withPlugin?.score).toBe(1);
    expect(evalCase?.targets[0]?.withPlugin?.gradedTries).toBe(2);
    expect(evalCase?.targets[1]?.notRunReason).toContain("not in Stigmer's catalog");
    expect(evalCase?.notes).toEqual(["a note"]);
    expect((await stored("aev_tries")).status?.plugins[0]?.cases[0]?.targets[0]?.withPlugin?.tries).toHaveLength(2);
  });
});

describe("a chain built wrong", () => {
  it("fails loudly when the agent, the version, the cancel's target or the delete's row was never stashed", async () => {
    const noAgent = await failure(() =>
      newResolveAgentEvalDefaultsStep(temp.store).execute(createCtx(evalRow("", PluginEvalPhase.unspecified))),
    );
    expect(noAgent.code).toBe(Code.Internal);
    expect(noAgent.rawMessage).toBe("evaluated agent not found in context");

    const noVersion = await failure(() =>
      newPlanAgentEvalStep({ readArchive: () => Promise.reject(new Error("unread")) }, catalog).execute(
        createCtx(evalRow("aev_1", PluginEvalPhase.unspecified)),
      ),
    );
    expect(noVersion.code).toBe(Code.Internal);
    expect(noVersion.rawMessage).toBe("evaluated agent version not found in context");

    const noTarget = await failure(() => newCancelAgentEvalStep(temp.store, workflows()).execute(bareIdCtx()));
    expect(noTarget.code).toBe(Code.Internal);
    expect(noTarget.rawMessage).toBe("agent eval not found in context");

    const noExisting = await failure(() => newRefuseActiveAgentEvalDeleteStep().execute(bareIdCtx()));
    expect(noExisting.code).toBe(Code.Internal);
    expect(noExisting.rawMessage).toBe("existing agent eval not found in context");
  });

  it("lets a finished eval's delete through", () => {
    const ctx = bareIdCtx();
    ctx.set(EXISTING_RESOURCE_KEY, evalRow("aev_1", PluginEvalPhase.completed));
    expect(() => newRefuseActiveAgentEvalDeleteStep().execute(ctx)).not.toThrow();
  });
});
